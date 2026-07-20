"""
main.py — ResumeAI Telegram notification service.

Subscribes to Redis pub/sub channel `application_events` and sends
Telegram messages to users who have connected their chat.

Event types handled:
  application_submitted  → ✉️ Applied to <role> at <company>
  interview_reply        → 📬 Recruiter reply at <company>
  linkedin_issue         → ⚠️ LinkedIn needs re-auth

Rate limit: 30 msgs / user / hour (per-chat Redis counter).
"""
import asyncio
import html as html_lib
import json
import signal
import sys

import httpx
import redis.asyncio as aioredis
import redis.exceptions as redis_exc
import sentry_sdk
import structlog

import templates
from config import settings
from database import get_pool, get_telegram_chat
from rate_limiter import is_allowed

# ── Sentry — init before the event loop starts ────────────────────────────────
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=0.1,
        sample_rate=1.0,
        send_default_pii=False,
    )

log = structlog.get_logger(__name__)

CHANNEL = "application_events"
TG_API = f"https://api.telegram.org/bot{settings.telegram_bot_token}"

# ── Telegram sender ────────────────────────────────────────────────────────────

async def send_message(client: httpx.AsyncClient, chat_id: str, text: str, url: str | None = None) -> bool:
    """Send a Telegram message. Returns True on success."""
    payload: dict = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": "Open Dashboard", "url": url}]]
        }
    try:
        resp = await client.post(f"{TG_API}/sendMessage", json=payload, timeout=10)
        if not resp.is_success:
            data = resp.json()
            # 403 = bot blocked by user — clean up gracefully downstream
            log.warning("tg.send_failed", chat_id=chat_id, status=resp.status_code,
                        description=data.get("description"))
            return False
        return True
    except httpx.HTTPError as exc:
        log.error("tg.send_error", chat_id=chat_id, error=str(exc))
        return False


# ── Event handler ─────────────────────────────────────────────────────────────

TOGGLE_MAP = {
    "application_submitted": "notifyOnSubmit",
    "interview_reply":       "notifyOnInterviewReply",
    "linkedin_issue":        "notifyOnLinkedInIssue",
}

async def handle_event(
    event: dict,
    pool,
    redis: aioredis.Redis,
    http: httpx.AsyncClient,
) -> None:
    event_type = event.get("type")
    user_id = event.get("userId")

    # Admin error alerts (P0.4): routed to the founder chat, not a user chat.
    # No per-user toggle; own rate-limit bucket so alert storms can't starve
    # user notifications (publishers also dedupe, see lib/alerts.ts).
    if event_type == "admin_alert":
        chat_id = settings.admin_telegram_chat_id
        if not chat_id:
            log.warning("admin_alert.no_chat_configured")
            return
        if not await is_allowed(redis, f"admin:{chat_id}", limit=settings.rate_limit_per_hour):
            log.info("admin_alert.rate_limited")
            return
        text = html_lib.escape(str(event.get("text") or "")[:3800])
        if not text:
            return
        # Optional title/emoji so routine reports (daily pulse, money alerts,
        # SEO watch) don't wear the error siren. Defaults preserve P0.4.
        title = html_lib.escape(str(event.get("title") or "ResumeAI alert")[:80])
        emoji = str(event.get("emoji") or "\N{POLICE CARS REVOLVING LIGHT}")[:8]
        ok = await send_message(http, chat_id, f"{emoji} <b>{title}</b>\n\n<pre>{text}</pre>")
        log.info("admin_alert.sent" if ok else "admin_alert.send_failed")
        return

    if not event_type or not user_id:
        log.warning("event.invalid", event=event)
        return

    toggle_key = TOGGLE_MAP.get(event_type)
    if not toggle_key:
        log.debug("event.unknown_type", event_type=event_type)
        return

    # Look up chat
    chat = await get_telegram_chat(pool, user_id)
    if not chat:
        log.debug("event.no_chat", user_id=user_id)
        return

    if not chat.get(toggle_key, True):
        log.debug("event.toggled_off", event_type=event_type, user_id=user_id)
        return

    # Rate limit
    chat_id = chat["chatId"]
    if not await is_allowed(redis, chat_id, limit=settings.rate_limit_per_hour):
        log.info("event.rate_limited", chat_id=chat_id, event_type=event_type)
        return

    # Build message
    app_id = event.get("applicationId")
    if event_type == "application_submitted":
        msg = templates.submitted(
            job_title=event.get("jobTitle", "a position"),
            company=event.get("company", "a company"),
            application_id=app_id,
        )
    elif event_type == "interview_reply":
        msg = templates.interview_reply(
            company=event.get("company", "a recruiter"),
            application_id=app_id,
        )
    else:  # linkedin_issue
        msg = templates.linkedin_issue()

    ok = await send_message(http, chat_id, msg["text"], msg.get("url"))
    log.info(
        "event.sent" if ok else "event.send_failed",
        event_type=event_type,
        chat_id=chat_id,
        user_id=user_id,
    )


# ── Main loop ─────────────────────────────────────────────────────────────────

async def _close_pubsub(pubsub) -> None:
    """Close a PubSub defensively across redis-py 5.x variants (aclose/close)."""
    try:
        await pubsub.aclose()
    except AttributeError:
        try:
            await pubsub.close()
        except Exception:
            pass
    except Exception:
        pass


async def run() -> None:
    log.info("notifier.starting", channel=CHANNEL)

    pool = await get_pool()
    # health_check_interval + TCP keepalive keep the long-lived pub/sub
    # connection alive across idle periods (notifier traffic is sparse) and
    # surface a dropped socket promptly instead of on a stale blocking read.
    redis = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
        health_check_interval=30,
        socket_keepalive=True,
        socket_connect_timeout=10,
    )

    async with httpx.AsyncClient() as http:
        backoff = 1
        # Outer reconnect loop: a transient Redis read timeout or a dropped
        # connection must NOT kill the process. Previously the TimeoutError
        # raised by pubsub.listen() propagated out of run() and crash-looped
        # the container; now we log, back off, and re-subscribe.
        while True:
            pubsub = redis.pubsub()
            try:
                await pubsub.subscribe(CHANNEL)
                log.info("notifier.ready", channel=CHANNEL)
                backoff = 1  # reset after a healthy (re)subscribe
                while True:
                    # timeout returns None on idle (and drives the health-check
                    # PING) — a normal "no message" tick, not a fatal error.
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=20
                    )
                    if not message or message.get("type") != "message":
                        continue
                    try:
                        event = json.loads(message["data"])
                    except (json.JSONDecodeError, TypeError) as exc:
                        log.warning("event.json_decode_error", error=str(exc))
                        continue
                    try:
                        await handle_event(event, pool, redis, http)
                    except Exception as exc:
                        log.error("event.handler_error", error=str(exc), event=event)
            except asyncio.CancelledError:
                raise
            except (redis_exc.ConnectionError, redis_exc.TimeoutError, OSError) as exc:
                log.warning("notifier.redis_reconnect", error=str(exc), backoff=backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            finally:
                await _close_pubsub(pubsub)


def main() -> None:
    # Graceful shutdown on SIGTERM/SIGINT
    loop = asyncio.new_event_loop()

    def _shutdown(sig):
        log.info("notifier.shutdown", signal=sig.name)
        loop.stop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _shutdown, sig)

    try:
        loop.run_until_complete(run())
    finally:
        loop.close()
        log.info("notifier.stopped")


if __name__ == "__main__":
    main()
