"""
careerops.py — Playwright-based ATS form auto-filler (CareerOps applicator).

Supports:
  Greenhouse      — boards.greenhouse.io / company.greenhouse.io
  Lever           — jobs.lever.co
  Workable        — apply.workable.com
  SmartRecruiters — jobs.smartrecruiters.com
  Jobvite         — jobs.jobvite.com
  Ashby           — jobs.ashbyhq.com
  Generic         — heuristic detection for any unknown ATS

Usage:
    applicator = CareerOpsApplicator()
    await applicator.start()
    result = await applicator.apply(job_url, user_data)
    await applicator.close()

user_data keys:
    first_name, last_name, email, phone, linkedin_url,
    resume_text, cover_letter, current_company (optional),
    portfolio_url (optional), location (optional)

Result dict:
    status  — "submitted" | "form_not_found" | "error"
    url     — the job URL processed
    ats     — detected ATS name
    error   — present when status="error"

Ported from: autoapply/ats_filler.py
Changes vs source:
  - Replaced logging with structlog
  - Renamed class ATSFiller -> CareerOpsApplicator
  - All log messages in English (source was already English)

P16 improvements (2026-05-19):
  - Workable: re-fills all fields on every step (not just step 0) so late-
    appearing required fields are never left blank.
  - Jobvite: dedicated handler (was falling through to apply_generic_form).
  - Ashby: dedicated handler (was falling through to apply_generic_form).
  - apply(): routes jobvite and ashby to their dedicated handlers.
"""
import asyncio
import random
import re
import tempfile
import os
from typing import Optional

import httpx
import structlog
from playwright.async_api import async_playwright, BrowserContext, Page

logger = structlog.get_logger(__name__)

_ATS_PATTERNS: dict[str, list[str]] = {
    "greenhouse":      [r"greenhouse\.io", r"boards\.greenhouse"],
    "lever":           [r"jobs\.lever\.co", r"lever\.co/.*jobs"],
    "workable":        [r"apply\.workable\.com", r"workable\.com.*apply"],
    "smartrecruiters": [r"jobs\.smartrecruiters\.com"],
    "jobvite":         [r"jobs\.jobvite\.com"],
    "ashby":           [r"jobs\.ashbyhq\.com"],
}


def detect_ats(url: str) -> str:
    """Return the detected ATS name based on URL patterns, or 'generic'."""
    for ats_name, patterns in _ATS_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, url, re.I):
                return ats_name
    return "generic"


async def _type_slow(page: Page, selector: str, text: str) -> None:
    """Fill a field character-by-character with human-like delays."""
    await page.click(selector)
    await page.wait_for_timeout(random.randint(80, 200))
    for char in text:
        await page.keyboard.type(char, delay=random.randint(25, 70))


async def _fill(page: Page, selector: str, value: str) -> bool:
    """Fill a field if it exists. Returns True on success."""
    try:
        loc = page.locator(selector).first
        if await loc.count() > 0:
            await loc.fill(value)
            await page.wait_for_timeout(random.randint(60, 150))
            return True
    except Exception:
        pass
    return False


def _render_resume_pdf(resume_text: str) -> str:
    """
    Render resume_text to a real PDF and return the temp file path.

    Most ATS (Greenhouse, Lever, Workable…) validate the uploaded file is a
    real document — a .txt is silently rejected, which was a key reason
    submissions never completed (P19).  Falls back to .txt only if reportlab
    is unavailable.
    """
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas as _canvas

        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        c = _canvas.Canvas(path, pagesize=letter)
        width, height = letter
        y = height - 72
        for raw_line in resume_text.split("\n"):
            # naive wrap at ~95 chars so long lines don't overflow the page
            line = raw_line if raw_line else " "
            while line:
                chunk, line = line[:95], line[95:]
                c.drawString(72, y, chunk)
                y -= 15
                if y < 72:
                    c.showPage()
                    y = height - 72
        c.save()
        return path
    except Exception as exc:  # reportlab missing or render error → .txt fallback
        logger.warning("careerops.pdf_render_failed", error=str(exc))
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as f:
            f.write(resume_text)
            return f.name


async def _upload_resume(page: Page, selector: str, resume_text: str) -> bool:
    """Render the resume to a PDF and upload it via the file input."""
    tmp_path = _render_resume_pdf(resume_text)
    try:
        await page.set_input_files(selector, tmp_path)
        await page.wait_for_timeout(1200)
        return True
    except Exception as exc:
        logger.warning("careerops.resume_upload_failed", selector=selector, error=str(exc))
        return False
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


async def _click_apply_button(page: Page) -> bool:
    """Find and click an Apply button if present. Returns True if clicked."""
    for text in [
        "Apply Now",
        "Apply for this Job",
        "Apply for this job",
        "Apply",
        "Easy Apply",
        "Submit Application",
    ]:
        loc = page.locator(f'a:has-text("{text}"), button:has-text("{text}")').first
        if await loc.count() > 0:
            await loc.click()
            await page.wait_for_load_state("networkidle", timeout=10000)
            await page.wait_for_timeout(random.randint(800, 1500))
            return True
    return False


async def _fill_standard_fields(page: Page, user_data: dict, field_map: dict) -> None:
    """Fill a dict of selector→value pairs, skipping empty values."""
    for sel, val in field_map.items():
        if val:
            await _fill(page, sel, val)


# Confirmation phrases ATS platforms show after a *successful* submission.
_SUCCESS_MARKERS = [
    "thank you for applying",
    "thank you for your application",
    "thank you for your interest",
    "application has been submitted",
    "your application was submitted",
    "your application has been received",
    "we have received your application",
    "application received",
    "successfully submitted",
    "thanks for applying",
    "submission received",
    "you have already applied",  # treat as already-submitted (still success-ish)
]

# Validation-error phrases that mean the submit was REJECTED (still on the form).
_ERROR_MARKERS = [
    "is required",
    "this field is required",
    "please complete",
    "please enter",
    "please select",
    "cannot be blank",
    "fix the errors",
    "required field",
]


async def _verify_submitted(page: Page) -> bool:
    """
    Return True only when the page shows real evidence the application was
    accepted — a confirmation message, a confirmation URL, or the application
    form having disappeared.  This replaces the old "clicked submit == success"
    assumption that produced false SUBMITTED records (P19, 2026-05-30).

    Conservative by design: when in doubt it returns False so the application
    is recorded as failed rather than a phantom success.
    """
    try:
        await page.wait_for_timeout(1200)
        body = (await page.inner_text("body")).lower()
    except Exception:
        body = ""

    # 1. Explicit confirmation text anywhere on the page.
    if any(m in body for m in _SUCCESS_MARKERS):
        return True

    # 2. Confirmation-style URL (Greenhouse/Lever redirect to a thanks page).
    try:
        if re.search(r"(thank|confirm|success|submitted|/thanks)", page.url, re.I):
            return True
    except Exception:
        pass

    # 3. Visible validation errors => definitely NOT submitted.
    if any(m in body for m in _ERROR_MARKERS):
        return False

    # 4. Heuristic: the application form's submit button is gone AND no
    #    required fields remain visible — strong signal the form was accepted.
    try:
        remaining = await page.evaluate("""() => {
            const submit = document.querySelector('input[type=submit], button[type=submit]');
            const reqEmpty = Array.from(document.querySelectorAll('input,select,textarea'))
                .filter(e => (e.required || e.getAttribute('aria-required')==='true')
                    && e.type !== 'hidden' && e.offsetParent !== null
                    && (!e.value || e.value.trim()===''));
            return { hasSubmit: !!submit, reqEmpty: reqEmpty.length };
        }""")
        if not remaining.get("hasSubmit") and remaining.get("reqEmpty", 1) == 0:
            return True
    except Exception:
        pass

    return False


def _pick_answer(label: str, options: list[str]) -> Optional[str]:
    """
    Choose the best option text for a screening/EEO question, given its label.
    Conservative, compliance-safe defaults (decline to self-identify; authorized
    to work = yes; visa sponsorship = no).  Returns None when no option fits.
    """
    L = label.lower()

    def find(*subs: str) -> Optional[str]:
        for s in subs:
            for o in options:
                if s in o.lower():
                    return o
        return None

    decline = find(
        "decline", "prefer not", "don't wish", "do not wish",
        "not to disclose", "not to answer", "not to identify", "not to specify",
    )
    if any(k in L for k in ["authoriz", "eligible to work", "legally authorized", "right to work"]):
        return find("yes") or (options[1] if len(options) > 1 else None)
    if any(k in L for k in ["sponsor", "visa", "immigration support"]):
        return find("no, i do not", "no, i will not", "no") or (options[1] if len(options) > 1 else None)
    if "hear about" in L or "how did you find" in L:
        return find("linkedin", "job board", "company website", "online", "other") or (options[1] if len(options) > 1 else None)
    if any(k in L for k in ["acknowledge", "hybrid", "onsite", "on-site", "relocat", "commute", "comfortable", "willing", "intend to work", "able to work"]):
        return find("yes", "i acknowledge", "i agree", "i understand", "remote") or (options[1] if len(options) > 1 else None)
    if any(k in L for k in ["former employer", "non-compete", "subject to any agreement", "restrictive covenant"]):
        return find("no") or (options[1] if len(options) > 1 else None)
    if any(k in L for k in ["years", "minimum of", "do you have", "experience with", "proficient"]):
        # Affirmative for "do you have X experience" screeners.
        return find("yes") or (options[1] if len(options) > 1 else None)
    if any(k in L for k in ["gender", "race", "ethnic", "sexual orientation", "veteran",
                            "disability", "identify", "lgbt", "transgender", "pronoun",
                            "first-generation", "hispanic", "latino"]):
        return decline or find("i am not", "no") or (options[-1] if options else None)
    return decline or (options[1] if len(options) > 1 else (options[0] if options else None))


async def _answer_react_selects(page: Page) -> int:
    """
    Answer every required react-select (Greenhouse/modern ATS) combobox by
    opening it, reading the rendered options, and clicking the best match.
    Returns the number of selects answered.
    """
    containers = page.locator(".select__container")
    answered = 0
    try:
        n = await containers.count()
    except Exception:
        return 0
    for i in range(n):
        cont = containers.nth(i)
        try:
            inp = cont.locator('input[role="combobox"]').first
            if await inp.count() == 0:
                continue
            # Skip Country / Location autocompletes — handled separately by typing.
            field_id = (await inp.get_attribute("id")) or ""
            if field_id in ("country", "candidate-location"):
                continue
            label = ""
            lab = cont.locator("label").first
            if await lab.count() > 0:
                label = (await lab.inner_text()).strip()
            control = cont.locator(".select__control").first
            await control.click()
            await page.wait_for_timeout(450)
            opts = page.locator(".select__option")
            oc = await opts.count()
            texts = []
            for k in range(min(oc, 30)):
                try:
                    texts.append((await opts.nth(k).inner_text()).strip())
                except Exception:
                    pass
            choice = _pick_answer(label, texts)
            clicked = False
            if choice:
                target = page.locator(f'.select__option:has-text("{choice[:30]}")').first
                if await target.count() > 0:
                    await target.click()
                    answered += 1
                    clicked = True
            if not clicked:
                await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)
        except Exception:
            try:
                await page.keyboard.press("Escape")
            except Exception:
                pass
    return answered


async def _fill_autocomplete(page: Page, field_id: str, value: str) -> bool:
    """Fill a Greenhouse autocomplete combobox (Country / Location) by typing
    then selecting the first suggested option."""
    try:
        inp = page.locator(f'#{field_id}').first
        if await inp.count() == 0 or not value:
            return False
        await inp.click()
        await inp.fill(value)
        await page.wait_for_timeout(1000)
        opt = page.locator('.select__option').first
        if await opt.count() > 0:
            await opt.click()
            return True
        # fall back to keyboard select
        await page.keyboard.press("Enter")
        return True
    except Exception:
        return False


async def _fill_questions_by_label(page: Page, mapping: list[tuple[list[str], str]]) -> None:
    """
    Fill per-job `question_*` text inputs by matching their label text.
    `mapping` is a list of (keywords, value).  First keyword match wins.
    """
    try:
        handles = await page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('input[id^="question_"], textarea[id^="question_"]').forEach(e => {
                if (e.offsetParent === null) return;
                if (e.getAttribute('role') === 'combobox') return;  // react-select handled elsewhere
                let lab = '';
                if (e.labels && e.labels[0]) lab = e.labels[0].innerText;
                if (!lab && e.getAttribute('aria-labelledby')) {
                    const l = document.getElementById(e.getAttribute('aria-labelledby'));
                    if (l) lab = l.innerText;
                }
                out.push({ id: e.id, label: (lab||'').toLowerCase() });
            });
            return out;
        }""")
    except Exception:
        return
    for h in handles:
        for keywords, value in mapping:
            if value and any(k in h["label"] for k in keywords):
                try:
                    await page.locator(f'#{h["id"]}').first.fill(value)
                except Exception:
                    pass
                break


async def _check_required_boxes(page: Page) -> None:
    """Tick any unchecked checkboxes (consent / acknowledgement gates)."""
    boxes = page.locator('input[type="checkbox"]')
    try:
        n = await boxes.count()
    except Exception:
        return
    for i in range(n):
        b = boxes.nth(i)
        try:
            if not await b.is_checked():
                await b.check(timeout=1500)
        except Exception:
            pass


async def _poll_greenhouse_code(
    email: str, company: str, resend_key: str, since_iso: str,
    attempts: int = 6, delay: float = 4.0,
) -> Optional[str]:
    """
    Poll the Resend inbound mailbox for Greenhouse's "Security code for your
    application to {company}" email and extract the code.

    Greenhouse requires unauthenticated applicants to verify their email by
    pasting a code, then resubmitting.  The code email arrives at the user's
    inbox handle within ~5-20 s.  Returns the code string or None.
    """
    if not resend_key:
        return None
    headers = {"Authorization": f"Bearer {resend_key}"}
    code_re = re.compile(r"application[:\s]*([A-Za-z0-9]{6,12})", re.I)
    company_key = company.lower()[:6]
    async with httpx.AsyncClient(timeout=15, headers=headers) as client:
        for _ in range(attempts):
            await asyncio.sleep(delay)
            try:
                r = await client.get("https://api.resend.com/emails/inbound")
                rows = r.json().get("data", []) if r.status_code == 200 else []
            except Exception:
                continue
            for m in rows:
                to = ",".join(m.get("to") or []).lower()
                frm = (m.get("from") or "").lower()
                subj = (m.get("subject") or "").lower()
                created = m.get("created_at", "")
                if email.lower() not in to:
                    continue
                if "greenhouse" not in frm or "security code" not in subj:
                    continue
                if company_key and company_key not in subj:
                    continue
                if since_iso and created < since_iso:
                    continue  # stale (from a previous attempt)
                try:
                    rd = await client.get(f"https://api.resend.com/emails/inbound/{m['id']}")
                    body = rd.json()
                    html = body.get("html") or body.get("text") or ""
                except Exception:
                    continue
                text = re.sub(r"<[^>]+>", " ", html)
                match = code_re.search(text)
                if match:
                    return match.group(1)
    return None


async def _complete_greenhouse_verification(
    page: Page, email: str, company: str,
) -> bool:
    """
    Handle Greenhouse's post-submit email-verification step: if a security-code
    field appeared, fetch the emailed code from the inbox, enter it, resubmit,
    and verify.  Returns True only on a confirmed submission.
    """
    # Greenhouse renders the security code as N single-character boxes
    # (id="security-input-0" … "security-input-{n-1}", maxlength=1).
    # Also support a single-field variant just in case.
    boxes = page.locator('input[id^="security-input-"]')
    single = None
    try:
        n_boxes = await boxes.count()
    except Exception:
        n_boxes = 0
    if n_boxes == 0:
        for sel in ['input#security_code', 'input[name*="security"]',
                    'input[aria-label*="ecurity code"]']:
            loc = page.locator(sel).first
            try:
                if await loc.count() > 0 and await loc.is_visible():
                    single = loc
                    break
            except Exception:
                pass
        if single is None:
            return False  # no security-code field present

    resend_key = os.environ.get("RESEND_API_KEY", "")
    import datetime
    since_iso = (datetime.datetime.utcnow() - datetime.timedelta(minutes=3)).strftime("%Y-%m-%d %H:%M:%S")
    code = await _poll_greenhouse_code(email, company, resend_key, since_iso)
    if not code:
        logger.warning("careerops.greenhouse.code_not_received", company=company)
        return False

    try:
        if n_boxes > 0:
            # Fill one character per box (focus + type so React registers each).
            for i in range(min(n_boxes, len(code))):
                box = page.locator(f'#security-input-{i}')
                await box.click()
                await box.fill(code[i])
                await page.wait_for_timeout(80)
        else:
            await single.fill(code)
        await page.wait_for_timeout(600)

        submit = page.locator('input[type="submit"], button[type="submit"]').first
        if await submit.count() > 0:
            await submit.click()
            try:
                await page.wait_for_load_state("networkidle", timeout=12000)
            except Exception:
                pass
            return await _verify_submitted(page)
    except Exception as exc:
        logger.warning("careerops.greenhouse.code_entry_failed", error=str(exc))
    return False


class CareerOpsApplicator:
    """Playwright-based form filler for major ATS platforms."""

    def __init__(self) -> None:
        self.browser = None
        self.context: Optional[BrowserContext] = None
        self._pw = None

    async def start(self) -> None:
        """Launch headless browser and create a browser context."""
        self._pw = await async_playwright().start()
        self.browser = await self._pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        self.context = await self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )

    async def close(self) -> None:
        """Close the browser and stop Playwright."""
        if self.browser:
            await self.browser.close()
        if self._pw:
            await self._pw.stop()

    async def apply(self, job_url: str, user_data: dict) -> dict:
        """
        Route to the appropriate ATS filler based on URL.
        Never raises — returns an error dict on unhandled exception.
        """
        ats = detect_ats(job_url)
        logger.info("careerops.apply.routing", url=job_url, ats=ats)
        try:
            if ats == "greenhouse":
                return await self.apply_greenhouse(job_url, user_data)
            if ats == "lever":
                return await self.apply_lever(job_url, user_data)
            if ats == "workable":
                return await self.apply_workable(job_url, user_data)
            if ats == "smartrecruiters":
                return await self.apply_smartrecruiters(job_url, user_data)
            if ats == "jobvite":
                return await self.apply_jobvite(job_url, user_data)
            if ats == "ashby":
                return await self.apply_ashby(job_url, user_data)
            return await self.apply_generic_form(job_url, user_data)
        except Exception as exc:
            logger.exception("careerops.apply.unhandled_error", url=job_url, error=str(exc))
            return {"status": "error", "url": job_url, "ats": ats, "error": str(exc)}

    # ── Greenhouse ───────────────────────────────────────────────────────────

    async def apply_greenhouse(self, job_url: str, user_data: dict) -> dict:
        """
        Greenhouse — both classic (boards.greenhouse.io) and the modern React
        embedded form (job-boards.greenhouse.io).

        Modern forms require: standard fields by id, Country/Location
        autocomplete comboboxes, per-job `question_*` text inputs (matched by
        label), react-select screening/EEO questions, consent checkboxes, and a
        real PDF resume.  We fill all of these, then only report `submitted`
        when _verify_submitted confirms acceptance (P19).
        """
        page = await self.context.new_page()
        try:
            # domcontentloaded (not "load") — the modern SPA form often never
            # fires a full load event; then give React time to render.
            await page.goto(job_url, timeout=45000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            await page.wait_for_timeout(random.randint(2000, 3000))

            first = user_data.get("first_name", "")
            last = user_data.get("last_name", "")
            # Standard fields by id, with autocomplete-attribute fallback.
            if not await _fill(page, "#first_name", first):
                await _fill(page, 'input[autocomplete="given-name"]', first)
            if not await _fill(page, "#last_name", last):
                await _fill(page, 'input[autocomplete="family-name"]', last)
            if not await _fill(page, "#email", user_data.get("email", "")):
                await _fill(page, 'input[autocomplete="email"]', user_data.get("email", ""))
            await _fill(page, "#phone", user_data.get("phone", ""))
            # Preferred First Name is a standard #preferred_name input (not a
            # question_* id) and is required on many boards — fill it directly.
            await _fill(page, "#preferred_name", first)

            # Country / Location autocomplete comboboxes.
            await _fill_autocomplete(page, "country", user_data.get("country", "") or "United States")
            await _fill_autocomplete(
                page, "candidate-location",
                user_data.get("location", "") or "Remote",
            )

            # Per-job question_* text inputs, matched by label.
            full_name = f"{first} {last}".strip()
            await _fill_questions_by_label(page, [
                (["linkedin"], user_data.get("linkedin_url", "")),
                (["preferred first name", "preferred name"], first),
                (["hear about", "how did you find", "how did you hear", "referred", "referral source"], "LinkedIn"),
                (["website", "portfolio"], user_data.get("portfolio_url", "")),
                (["where do you intend to work", "where will you work", "current location", "location (city"], user_data.get("location", "") or "Remote"),
                (["zip", "postal"], "94103"),
                (["city"], user_data.get("location", "") or "Remote"),
                (["full name", "your name", "legal name"], full_name),
            ])

            # Resume (real PDF).
            resume_text = user_data.get("resume_text", "")
            if resume_text:
                for sel in [
                    'input[type="file"][name*="resume"]',
                    'input[type="file"][id*="resume"]',
                    'input[type="file"]',
                ]:
                    if await page.locator(sel).count() > 0:
                        await _upload_resume(page, sel, resume_text)
                        break

            # Cover letter (text field if present).
            cover_letter = user_data.get("cover_letter", "")
            for sel in ['textarea[name*="cover"]', 'textarea[id*="cover"]', '#cover_letter']:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            # Screening / EEO react-select questions + consent checkboxes.
            answered = await _answer_react_selects(page)
            await _check_required_boxes(page)
            logger.info("careerops.greenhouse.filled", url=job_url, selects_answered=answered)

            submit = page.locator('input[type="submit"], button[type="submit"]').first
            if await submit.count() > 0:
                await submit.click()
                try:
                    await page.wait_for_load_state("networkidle", timeout=12000)
                except Exception:
                    pass
                if await _verify_submitted(page):
                    logger.info("careerops.greenhouse.submitted", url=job_url)
                    return {"status": "submitted", "url": job_url, "ats": "greenhouse"}

                # Greenhouse email-verification step: a security-code field
                # appears and a code is emailed to the applicant. Fetch it from
                # the inbox, enter it, and resubmit to finalize the application.
                company = (user_data.get("_company") or "").strip()
                if await _complete_greenhouse_verification(
                    page, user_data.get("email", ""), company,
                ):
                    logger.info("careerops.greenhouse.submitted_after_code", url=job_url)
                    return {"status": "submitted", "url": job_url, "ats": "greenhouse"}

                logger.warning("careerops.greenhouse.submit_unconfirmed", url=job_url)
                return {"status": "error", "url": job_url, "ats": "greenhouse",
                        "error": "submission not confirmed (required fields or email code incomplete)"}

            return {"status": "form_not_found", "url": job_url, "ats": "greenhouse"}
        finally:
            await page.close()

    # ── Lever ────────────────────────────────────────────────────────────────

    async def apply_lever(self, job_url: str, user_data: dict) -> dict:
        """Lever: jobs.lever.co/company/job-id — click Apply then fill React form."""
        page = await self.context.new_page()
        try:
            await page.goto(job_url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(random.randint(1000, 2000))

            await _click_apply_button(page)

            full_name = (
                f"{user_data.get('first_name', '')} "
                f"{user_data.get('last_name', '')}".strip()
            )
            field_map = {
                'input[name="name"]': full_name,
                'input[name="email"]': user_data.get("email", ""),
                'input[name="phone"]': user_data.get("phone", ""),
                'input[name="org"]': user_data.get("current_company", ""),
                'input[name="urls[LinkedIn]"]': user_data.get("linkedin_url", ""),
                'input[name="urls[Portfolio]"]': user_data.get("portfolio_url", ""),
            }
            for sel, val in field_map.items():
                if val:
                    await _fill(page, sel, val)

            resume_text = user_data.get("resume_text", "")
            if resume_text:
                for sel in [
                    'input[type="file"][name*="resume"]',
                    'input[type="file"]',
                ]:
                    if await page.locator(sel).count() > 0:
                        await _upload_resume(page, sel, resume_text)
                        break

            cover_letter = user_data.get("cover_letter", "")
            for sel in [
                'textarea[name*="comments"]',
                'textarea[name*="cover"]',
                'textarea',
            ]:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            for txt in ["Submit Application", "Submit"]:
                btn = page.locator(f'button[type="submit"]:has-text("{txt}")').first
                if await btn.count() > 0:
                    await btn.click()
                    await page.wait_for_load_state("networkidle", timeout=15000)
                    if await _verify_submitted(page):
                        logger.info("careerops.lever.submitted", url=job_url)
                        return {"status": "submitted", "url": job_url, "ats": "lever"}
                    logger.warning("careerops.lever.submit_unconfirmed", url=job_url)
                    return {"status": "error", "url": job_url, "ats": "lever",
                            "error": "submission not confirmed"}

            return {"status": "form_not_found", "url": job_url, "ats": "lever"}
        finally:
            await page.close()

    # ── Workable ─────────────────────────────────────────────────────────────

    async def apply_workable(self, job_url: str, user_data: dict) -> dict:
        """
        Workable: apply.workable.com/*/j/*/apply — multi-step wizard.

        KEY FIX (P16): Re-fills form fields on every step, not just before
        the loop.  Workable's wizard conditionally shows fields based on step
        (e.g. step 1: personal info; step 2: questions; step 3: resume).
        The original code filled once then only clicked Next, so anything
        appearing on step 2+ was left blank.
        """
        page = await self.context.new_page()
        try:
            apply_url = (
                job_url if "/apply" in job_url else job_url.rstrip("/") + "/apply"
            )
            await page.goto(apply_url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(random.randint(1000, 2000))

            for _step in range(5):
                # Re-fill standard fields on every step (new ones may have appeared)
                field_map = {
                    'input[name="firstname"]': user_data.get("first_name", ""),
                    'input[name="lastname"]': user_data.get("last_name", ""),
                    'input[name="email"]': user_data.get("email", ""),
                    'input[name="phone"]': user_data.get("phone", ""),
                    'input[name="address"]': user_data.get("location", ""),
                }
                for sel, val in field_map.items():
                    if val:
                        await _fill(page, sel, val)

                resume_text = user_data.get("resume_text", "")
                if resume_text:
                    for sel in ['input[type="file"]']:
                        if await page.locator(sel).count() > 0:
                            await _upload_resume(page, sel, resume_text)
                            break

                cover_letter = user_data.get("cover_letter", "")
                for sel in [
                    'textarea[name*="cover"]',
                    'textarea[placeholder*="cover"]',
                ]:
                    if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                        break

                # Try Submit first (highest priority)
                submitted = False
                for txt in ["Submit Application", "Submit"]:
                    btn = page.locator(
                        f'button:has-text("{txt}"), input[value="{txt}"]'
                    ).first
                    if await btn.count() > 0:
                        await btn.click()
                        await page.wait_for_load_state("networkidle", timeout=10000)
                        if await _verify_submitted(page):
                            logger.info("careerops.workable.submitted", url=job_url)
                            return {
                                "status": "submitted",
                                "url": job_url,
                                "ats": "workable",
                            }
                        logger.warning("careerops.workable.submit_unconfirmed", url=job_url)
                        return {"status": "error", "url": job_url, "ats": "workable",
                                "error": "submission not confirmed"}

                # Then try Next / Continue
                advanced = False
                for txt in ["Next", "Continue", "Next Step"]:
                    btn = page.locator(
                        f'button:has-text("{txt}"), input[value="{txt}"]'
                    ).first
                    if await btn.count() > 0:
                        await btn.click()
                        await page.wait_for_load_state("networkidle", timeout=10000)
                        await page.wait_for_timeout(1500)
                        advanced = True
                        break

                if not advanced:
                    break  # No button found — bail out

            return {"status": "form_not_found", "url": job_url, "ats": "workable"}
        finally:
            await page.close()

    # ── SmartRecruiters ───────────────────────────────────────────────────────

    async def apply_smartrecruiters(self, job_url: str, user_data: dict) -> dict:
        """SmartRecruiters: jobs.smartrecruiters.com/company/job-id"""
        page = await self.context.new_page()
        try:
            await page.goto(job_url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(random.randint(1000, 2000))

            await _click_apply_button(page)

            field_map = {
                'input[name="firstName"]': user_data.get("first_name", ""),
                'input[name="lastName"]': user_data.get("last_name", ""),
                'input[name="email"]': user_data.get("email", ""),
                'input[name="phone"]': user_data.get("phone", ""),
            }
            for sel, val in field_map.items():
                if val:
                    await _fill(page, sel, val)

            resume_text = user_data.get("resume_text", "")
            if resume_text:
                for sel in ['input[type="file"]']:
                    if await page.locator(sel).count() > 0:
                        await _upload_resume(page, sel, resume_text)
                        break

            submit = page.locator('button[type="submit"]').first
            if await submit.count() > 0:
                await submit.click()
                await page.wait_for_load_state("networkidle", timeout=15000)
                if await _verify_submitted(page):
                    logger.info("careerops.smartrecruiters.submitted", url=job_url)
                    return {"status": "submitted", "url": job_url, "ats": "smartrecruiters"}
                logger.warning("careerops.smartrecruiters.submit_unconfirmed", url=job_url)
                return {"status": "error", "url": job_url, "ats": "smartrecruiters",
                        "error": "submission not confirmed"}

            return {"status": "form_not_found", "url": job_url, "ats": "smartrecruiters"}
        finally:
            await page.close()

    # ── Jobvite ───────────────────────────────────────────────────────────────

    async def apply_jobvite(self, job_url: str, user_data: dict) -> dict:
        """
        Jobvite: jobs.jobvite.com — click Apply, fill form, submit.

        NEW in P16: dedicated handler (was falling through to apply_generic_form).
        Jobvite uses id-prefixed inputs and a multi-step flow with a submit
        button type of "submit".
        """
        page = await self.context.new_page()
        try:
            await page.goto(job_url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(random.randint(1000, 2000))

            await _click_apply_button(page)
            await page.wait_for_timeout(1500)

            field_map = {
                'input#first-name, input[name="firstName"], input[id*="first"]': user_data.get("first_name", ""),
                'input#last-name, input[name="lastName"], input[id*="last"]': user_data.get("last_name", ""),
                'input#email, input[name="email"], input[type="email"]': user_data.get("email", ""),
                'input#phone, input[name="phone"], input[type="tel"]': user_data.get("phone", ""),
                'input[name*="linkedin"], input[id*="linkedin"]': user_data.get("linkedin_url", ""),
            }
            for sel, val in field_map.items():
                if val:
                    await _fill(page, sel, val)

            resume_text = user_data.get("resume_text", "")
            if resume_text:
                for sel in ['input[type="file"]']:
                    if await page.locator(sel).count() > 0:
                        await _upload_resume(page, sel, resume_text)
                        break

            cover_letter = user_data.get("cover_letter", "")
            for sel in [
                'textarea[name*="cover"]',
                'textarea[id*="cover"]',
                'textarea[placeholder*="cover"]',
            ]:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            # Jobvite may have multiple pages; click Next/Submit up to 4 times
            for _step in range(4):
                for txt in ["Submit Application", "Submit", "Apply"]:
                    btn = page.locator(
                        f'button[type="submit"]:has-text("{txt}"), '
                        f'input[type="submit"][value*="{txt}"]'
                    ).first
                    if await btn.count() > 0:
                        await btn.click()
                        await page.wait_for_load_state("networkidle", timeout=15000)
                        if await _verify_submitted(page):
                            logger.info("careerops.jobvite.submitted", url=job_url)
                            return {"status": "submitted", "url": job_url, "ats": "jobvite"}
                        logger.warning("careerops.jobvite.submit_unconfirmed", url=job_url)
                        return {"status": "error", "url": job_url, "ats": "jobvite",
                                "error": "submission not confirmed"}

                # Try next page
                advanced = False
                for txt in ["Next", "Continue", "Next Step"]:
                    btn = page.locator(f'button:has-text("{txt}")').first
                    if await btn.count() > 0:
                        await btn.click()
                        await page.wait_for_load_state("networkidle", timeout=10000)
                        await page.wait_for_timeout(1500)
                        advanced = True
                        break
                if not advanced:
                    break

            return {"status": "form_not_found", "url": job_url, "ats": "jobvite"}
        finally:
            await page.close()

    # ── Ashby ─────────────────────────────────────────────────────────────────

    async def apply_ashby(self, job_url: str, user_data: dict) -> dict:
        """
        Ashby HQ: jobs.ashbyhq.com — click Apply, fill React form, submit.

        NEW in P16: dedicated handler (was falling through to apply_generic_form).
        Ashby uses data-field-id attributes on inputs; falls back to
        placeholder-based selectors for flexibility.
        """
        page = await self.context.new_page()
        try:
            await page.goto(job_url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(random.randint(1000, 2000))

            await _click_apply_button(page)
            await page.wait_for_load_state("networkidle", timeout=10000)
            await page.wait_for_timeout(1500)

            # Try data-field-id attrs first, fall back to placeholder/type selectors
            fields: list[tuple[str, str]] = [
                ('input[data-field-id="firstName"], input[placeholder*="First"]', user_data.get("first_name", "")),
                ('input[data-field-id="lastName"], input[placeholder*="Last"]', user_data.get("last_name", "")),
                ('input[data-field-id="email"], input[type="email"]', user_data.get("email", "")),
                ('input[data-field-id="phone"], input[type="tel"]', user_data.get("phone", "")),
                ('input[data-field-id="linkedIn"], input[placeholder*="LinkedIn"]', user_data.get("linkedin_url", "")),
            ]
            for sel, val in fields:
                if val:
                    await _fill(page, sel, val)

            resume_text = user_data.get("resume_text", "")
            if resume_text:
                for sel in [
                    'input[type="file"][aria-label*="resume"]',
                    'input[type="file"]',
                ]:
                    if await page.locator(sel).count() > 0:
                        await _upload_resume(page, sel, resume_text)
                        break

            cover_letter = user_data.get("cover_letter", "")
            for sel in [
                'textarea[data-field-id="coverLetter"]',
                'textarea[placeholder*="cover"]',
                'textarea[placeholder*="Cover"]',
                'textarea',
            ]:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            submit = page.locator(
                'button[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")'
            ).first
            if await submit.count() > 0:
                await submit.click()
                await page.wait_for_load_state("networkidle", timeout=15000)
                if await _verify_submitted(page):
                    logger.info("careerops.ashby.submitted", url=job_url)
                    return {"status": "submitted", "url": job_url, "ats": "ashby"}
                logger.warning("careerops.ashby.submit_unconfirmed", url=job_url)
                return {"status": "error", "url": job_url, "ats": "ashby",
                        "error": "submission not confirmed"}

            return {"status": "form_not_found", "url": job_url, "ats": "ashby"}
        finally:
            await page.close()

    # ── Generic ───────────────────────────────────────────────────────────────

    async def apply_generic_form(self, job_url: str, user_data: dict) -> dict:
        """
        Heuristic form detection for unknown ATS systems.
        Finds fields by name/id/placeholder patterns, fills them, then submits.
        """
        page = await self.context.new_page()
        try:
            await page.goto(job_url, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(random.randint(1000, 2000))

            await _click_apply_button(page)

            full_name = (
                f"{user_data.get('first_name', '')} "
                f"{user_data.get('last_name', '')}".strip()
            )
            email = user_data.get("email", "")
            phone = user_data.get("phone", "")
            linkedin = user_data.get("linkedin_url", "")

            field_patterns: list[tuple[str, list[str]]] = [
                (user_data.get("first_name", ""), [
                    'input[name="first_name"]',
                    'input[name*="first"][name*="name"]',
                    'input[id*="first_name"]',
                    'input[placeholder*="First name"]',
                    'input[placeholder*="First Name"]',
                ]),
                (user_data.get("last_name", ""), [
                    'input[name="last_name"]',
                    'input[name*="last"][name*="name"]',
                    'input[id*="last_name"]',
                    'input[placeholder*="Last name"]',
                    'input[placeholder*="Last Name"]',
                ]),
                (full_name, [
                    'input[name="name"]',
                    'input[name="full_name"]',
                    'input[placeholder*="Full name"]',
                    'input[placeholder*="Your name"]',
                ]),
                (email, [
                    'input[type="email"]',
                    'input[name="email"]',
                    'input[id="email"]',
                    'input[placeholder*="Email"]',
                ]),
                (phone, [
                    'input[type="tel"]',
                    'input[name="phone"]',
                    'input[id="phone"]',
                    'input[placeholder*="Phone"]',
                ]),
                (linkedin, [
                    'input[name*="linkedin"]',
                    'input[id*="linkedin"]',
                    'input[placeholder*="LinkedIn"]',
                ]),
            ]

            filled = 0
            for value, selectors in field_patterns:
                if not value:
                    continue
                for sel in selectors:
                    try:
                        if await page.locator(sel).count() > 0:
                            await _fill(page, sel, value)
                            filled += 1
                            break
                    except Exception:
                        continue

            resume_text = user_data.get("resume_text", "")
            if resume_text:
                for sel in [
                    'input[type="file"][name*="resume"]',
                    'input[type="file"][accept*=".pdf"]',
                    'input[type="file"]',
                ]:
                    if await page.locator(sel).count() > 0:
                        await _upload_resume(page, sel, resume_text)
                        break

            cover_letter = user_data.get("cover_letter", "")
            for sel in [
                'textarea[name*="cover"]',
                'textarea[id*="cover"]',
                'textarea[placeholder*="cover"]',
                'textarea[name*="letter"]',
                'textarea[placeholder*="letter"]',
            ]:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            if filled == 0:
                logger.warning("careerops.generic.no_fields_filled", url=job_url)
                return {"status": "form_not_found", "url": job_url, "ats": "generic"}

            for txt in ["Submit Application", "Apply Now", "Apply", "Submit"]:
                btn = page.locator(
                    f'button[type="submit"]:has-text("{txt}"), '
                    f'input[type="submit"][value*="{txt}"]'
                ).first
                if await btn.count() > 0:
                    await btn.click()
                    await page.wait_for_load_state("networkidle", timeout=15000)
                    if await _verify_submitted(page):
                        logger.info(
                            "careerops.generic.submitted",
                            url=job_url,
                            fields_filled=filled,
                        )
                        return {
                            "status": "submitted",
                            "url": job_url,
                            "ats": "generic",
                            "fields_filled": filled,
                        }
                    logger.warning("careerops.generic.submit_unconfirmed", url=job_url)
                    return {"status": "error", "url": job_url, "ats": "generic",
                            "error": "submission not confirmed", "fields_filled": filled}

            # Last resort: any submit button
            fallback = page.locator('button[type="submit"], input[type="submit"]').first
            if await fallback.count() > 0:
                await fallback.click()
                await page.wait_for_load_state("networkidle", timeout=15000)
                if await _verify_submitted(page):
                    return {
                        "status": "submitted",
                        "url": job_url,
                        "ats": "generic",
                        "fields_filled": filled,
                    }
                return {"status": "error", "url": job_url, "ats": "generic",
                        "error": "submission not confirmed", "fields_filled": filled}

            return {"status": "form_not_found", "url": job_url, "ats": "generic"}
        finally:
            await page.close()
