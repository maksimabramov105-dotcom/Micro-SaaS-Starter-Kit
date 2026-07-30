#!/usr/bin/env python3
"""
migrate_domain.py — one-command resumeai-bot.ru -> resumeai-bot.com migration.

RUN THIS ON THE VPS (it needs /opt/resumeai/.env, docker and the Caddyfile):

    export CF_API_TOKEN='<token with Zone:DNS:Edit on both zones>'
    python3 /opt/resumeai/scripts/migrate_domain.py            # dry run, changes nothing
    python3 /opt/resumeai/scripts/migrate_domain.py --apply    # do it

Everything here was previously manual. The only thing it cannot do is create the
Cloudflare token itself (see docs/DOMAIN_MIGRATION.md).

DESIGN NOTES — read before changing the order of stages:

  * Resend's free plan allows ONE domain. Adding .com therefore REQUIRES deleting
    .ru first, and between that delete and .com being verified, ALL transactional
    email is down (magic-link sign-in, rescue delivery, refunds, nurture). Stages
    3-5 are deliberately back-to-back and the DNS records are written by API
    immediately, so the window is minutes, not hours.
  * INBOX_DOMAIN stays on .ru ON PURPOSE. Nine users hold @inbox.resumeai-bot.ru
    addresses; repointing it does not migrate them and their inbound mail would
    silently stop. The .ru MX must keep accepting mail indefinitely.
  * .ru keeps serving and 301-redirects to .com so the 301 indexed URLs pass
    their equity instead of 404ing.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request, urllib.error

ORIGIN_IP   = "178.105.185.214"
OLD         = "resumeai-bot.ru"
NEW         = "resumeai-bot.com"
ZONE_NEW    = "8c0737388a51d7eb2dd950b78199b97e"
ZONE_OLD    = "d8fd258342ce61c91ef732142bb5d53b"
ENV_PATH    = "/opt/resumeai/.env"
COMPOSE_DIR = "/opt/resumeai"

CF   = "https://api.cloudflare.com/client/v4"
ok   = lambda m: print(f"  \033[32m✓\033[0m {m}")
warn = lambda m: print(f"  \033[33m!\033[0m {m}")
die  = lambda m: (print(f"  \033[31m✗ {m}\033[0m"), sys.exit(1))


def http(url, method="GET", token=None, body=None, hdrs=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    if hdrs: h.update(hdrs)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}") or {"_status": e.code}


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def env_get(key):
    for line in open(ENV_PATH):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def env_set(key, value, apply):
    """Idempotent in-place upsert of KEY=value, backing the file up once."""
    if not apply:
        print(f"    would set {key}={value}")
        return
    src = open(ENV_PATH).read()
    if not os.path.exists(ENV_PATH + ".pre-migration"):
        open(ENV_PATH + ".pre-migration", "w").write(src)
    if re.search(rf"^{re.escape(key)}=", src, re.M):
        src = re.sub(rf"^{re.escape(key)}=.*$", f"{key}={value}", src, flags=re.M)
    else:
        src = src.rstrip("\n") + f"\n{key}={value}\n"
    open(ENV_PATH, "w").write(src)
    ok(f"{key}={value}")


def cf_upsert(zone, token, rtype, name, content, apply, proxied=False, prio=None, ttl=1):
    """Create-or-update one DNS record. Safe to re-run."""
    q = http(f"{CF}/zones/{zone}/dns_records?type={rtype}&name={name}", token=token)
    if not q.get("success"):
        die(f"CF read failed for {name}: {json.dumps(q.get('errors'))[:160]}")
    payload = {"type": rtype, "name": name, "content": content, "ttl": ttl, "proxied": proxied}
    if prio is not None: payload["priority"] = prio
    existing = q.get("result") or []
    if not apply:
        print(f"    would {'update' if existing else 'create'} {rtype:6} {name} -> {content[:60]}")
        return
    if existing:
        r = http(f"{CF}/zones/{zone}/dns_records/{existing[0]['id']}", "PUT", token, payload)
    else:
        r = http(f"{CF}/zones/{zone}/dns_records", "POST", token, payload)
    if r.get("success"): ok(f"{rtype:6} {name} -> {content[:60]}")
    else: die(f"{rtype} {name}: {json.dumps(r.get('errors'))[:200]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually make changes")
    ap.add_argument("--skip-email", action="store_true",
                    help="do site DNS + cutover only; leave Resend on .ru")
    a = ap.parse_args()
    apply = a.apply
    mode = "\033[31mAPPLY\033[0m" if apply else "\033[33mDRY RUN\033[0m (nothing will change)"
    print(f"\n=== {OLD} -> {NEW} migration [{mode}] ===\n")

    token = os.environ.get("CF_API_TOKEN", "").strip()
    if not token: die("CF_API_TOKEN not set. See docs/DOMAIN_MIGRATION.md.")

    # ── 1. token really has DNS:Edit ──────────────────────────────────────
    print("[1] Cloudflare token")
    probe = http(f"{CF}/zones/{ZONE_NEW}/dns_records?per_page=1", token=token)
    if not probe.get("success"):
        die("token cannot read DNS records (needs Zone→DNS→Edit on BOTH zones). "
            f"error: {json.dumps(probe.get('errors'))[:200]}")
    ok(f"token can read {NEW} DNS ({len(probe.get('result') or [])} sampled)")

    # ── 2. site DNS ───────────────────────────────────────────────────────
    print(f"\n[2] Site DNS for {NEW} -> {ORIGIN_IP}")
    cf_upsert(ZONE_NEW, token, "A", NEW, ORIGIN_IP, apply, proxied=False)
    cf_upsert(ZONE_NEW, token, "CNAME", f"www.{NEW}", NEW, apply, proxied=False)

    # ── 3-5. email (skippable) ────────────────────────────────────────────
    if a.skip_email:
        warn("--skip-email: Resend stays on .ru; EMAIL_DOMAIN pinned to .ru")
    else:
        rk = env_get("RESEND_API_KEY")
        if not rk: die("RESEND_API_KEY missing from .env")
        print(f"\n[3] Resend swap  \033[33m(email is DOWN from here until [5] verifies)\033[0m")
        doms = http("https://api.resend.com/domains", token=rk).get("data", [])
        by = {d["name"]: d for d in doms}
        if NEW in by:
            ok(f"{NEW} already present (status={by[NEW].get('status')})")
            detail = http(f"https://api.resend.com/domains/{by[NEW]['id']}", token=rk)
        else:
            if OLD in by:   # free plan = 1 domain, so the old one must go first
                if apply:
                    http(f"https://api.resend.com/domains/{by[OLD]['id']}", "DELETE", rk)
                    ok(f"deleted {OLD} from Resend")
                else:
                    print(f"    would DELETE {OLD} from Resend (plan allows 1 domain)")
            if not apply:
                print(f"    would add {NEW} to Resend and write its DKIM/SPF records")
                detail = {"records": []}
            else:
                detail = http("https://api.resend.com/domains", "POST", rk,
                              {"name": NEW, "region": "us-east-1"})
                if "id" not in detail:
                    die(f"could not add {NEW}: {json.dumps(detail)[:200]}")
                ok(f"added {NEW} (id={detail['id']})")

        print(f"\n[4] Writing Resend DNS records into Cloudflare")
        for r in detail.get("records", []):
            rtype = (r.get("record") or r.get("type") or "").upper()
            name  = r.get("name") or NEW
            if not name.endswith(NEW): name = f"{name}.{NEW}"
            cf_upsert(ZONE_NEW, token, rtype, name, r.get("value", ""), apply,
                      prio=r.get("priority"))

        print(f"\n[5] Waiting for Resend to verify {NEW}")
        if apply and detail.get("id"):
            http(f"https://api.resend.com/domains/{detail['id']}/verify", "POST", rk)
            for i in range(30):                       # ~5 min
                st = http(f"https://api.resend.com/domains/{detail['id']}", token=rk).get("status")
                print(f"    [{i+1}/30] status={st}")
                if st == "verified": ok("verified"); break
                time.sleep(10)
            else:
                warn("not verified yet — DNS can take longer. Re-run with --apply later; "
                     "it is idempotent. Email stays down until it verifies.")
        else:
            print("    (dry run)")

    # ── 6. Caddy ──────────────────────────────────────────────────────────
    print(f"\n[6] Caddy: serve {NEW}, 301 {OLD} -> {NEW}")
    caddyfile = f"{COMPOSE_DIR}/Caddyfile"
    cur = open(caddyfile).read() if os.path.exists(caddyfile) else ""
    if NEW in cur:
        ok("Caddyfile already mentions the new domain")
    elif not apply:
        print(f"    would rewrite {caddyfile}: {NEW} vhost + 301 from {OLD}")
    else:
        open(caddyfile + ".pre-migration", "w").write(cur)
        # Point the existing vhost at the new host, then redirect the old one.
        new_cfg = cur.replace(f"{OLD} ", f"{NEW} ").replace(f"{OLD} {{", f"{NEW} {{")
        new_cfg += f"""
# Added by migrate_domain.py — old domain keeps serving a 301 so the ~301
# indexed URLs pass equity to {NEW} instead of 404ing.
{OLD}, www.{OLD} {{
    redir https://{NEW}{{uri}} permanent
}}
"""
        open(caddyfile, "w").write(new_cfg)
        ok(f"rewrote {caddyfile} (backup: {caddyfile}.pre-migration)")

    # ── 7. env ────────────────────────────────────────────────────────────
    print(f"\n[7] Env cutover")
    env_set("NEXT_PUBLIC_APP_URL", f"https://{NEW}", apply)
    env_set("NEXTAUTH_URL", f"https://{NEW}", apply)
    if a.skip_email:
        env_set("EMAIL_DOMAIN", OLD, apply)
    else:
        env_set("RESEND_FROM", f"noreply@{NEW}", apply)
        env_set("EMAIL_FROM", f"noreply@{NEW}", apply)
    # NOT touched on purpose — 9 users hold @inbox.<old> handles.
    warn(f"INBOX_DOMAIN left on {OLD} (9 users hold handles there) — migrate separately")

    # ── 8. restart ────────────────────────────────────────────────────────
    print(f"\n[8] Restart")
    if apply:
        print(sh(f"cd {COMPOSE_DIR} && docker compose up -d caddy web worker notifier 2>&1 | tail -5"))
        ok("containers restarted")
    else:
        print("    would: docker compose up -d caddy web worker notifier")

    # ── 9. verify ─────────────────────────────────────────────────────────
    print(f"\n[9] Verify")
    if apply:
        time.sleep(15)
        for path in ["/api/health", "/", "/sitemap.xml"]:
            code = sh(f'curl -s -o /dev/null -w "%{{http_code}}" --max-time 25 https://{NEW}{path}')
            (ok if code == "200" else warn)(f"https://{NEW}{path} -> {code}")
        rd = sh(f'curl -s -o /dev/null -w "%{{http_code}} %{{redirect_url}}" --max-time 25 https://{OLD}/pricing')
        ok(f"https://{OLD}/pricing -> {rd}")
    else:
        print(f"    would curl https://{NEW}/api/health , / , /sitemap.xml and the {OLD} redirect")

    print(f"\n=== done ({'applied' if apply else 'dry run — re-run with --apply'}) ===")
    print("Still yours afterwards: Google/Bing Search Console, and the OAuth")
    print("redirect URIs in the Google Cloud Console + GitHub OAuth app.\n")


if __name__ == "__main__":
    main()
