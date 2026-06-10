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
import json
import random
import re
import tempfile
import os
from typing import Optional

import httpx
import structlog
from playwright.async_api import async_playwright, BrowserContext, Page

from worker.autoapply import eligibility as _elig

logger = structlog.get_logger(__name__)

# LLM client (reused from the resume pipeline) for answering job-specific
# screening questions the deterministic heuristics can't resolve.
try:
    from worker.ai.resume import _call_openai
    from worker.config import settings as _settings
    _LLM_AVAILABLE = True
except Exception:  # pragma: no cover - keeps applicator usable without AI deps
    _LLM_AVAILABLE = False
    _call_openai = None  # type: ignore
    _settings = None  # type: ignore

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


async def _fill_phone(page: Page, value: str) -> bool:
    """
    Enter an international phone number into a Greenhouse phone field
    (intl-tel-input v18). Worldwide-correct: the widget defaults to US (+1) and
    a foreign number (e.g. +61…) validates as a too-short US number, so we must
    SELECT the right country first. We do this generically from the dial-code so
    it works for ANY country, then type the national digits.

    Mechanism (the reliable one): open the country dropdown via a REAL Playwright
    click on the `iti__selected-country` button (v18 listens for real pointer
    events, not JS .click()), find the country whose data-dial-code is the
    longest prefix of the number, REAL-click that `<li>`, then type the national
    part. Falls back to typing the full E.164, then .fill().
    """
    if not value:
        return False
    digits = re.sub(r"[^0-9]", "", value)
    for sel in ['#phone', 'input[type="tel"].iti__tel-input', 'input[type="tel"]',
                'input[autocomplete="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]']:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0 or not await loc.is_visible():
                continue

            # 1) Select the country in the intl-tel-input dropdown (real clicks).
            selected_dial = ""
            try:
                btn = page.locator(
                    'button.iti__selected-country, .iti__selected-flag, [class*="selected-country" i]'
                ).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()  # real click → opens the v18 dialog
                    await page.wait_for_timeout(300)
                    # Pick the <li> whose dial-code is the longest prefix of digits.
                    pick = await page.evaluate(
                        """(digits) => {
                            const items = Array.from(document.querySelectorAll(
                                '.iti__country[data-dial-code], li[data-dial-code]'));
                            let best=null,bestLen=0;
                            for (const it of items){
                                const dc=it.getAttribute('data-dial-code')||'';
                                if(dc && digits.startsWith(dc) && dc.length>bestLen){best=it;bestLen=dc.length;}
                            }
                            return best ? {id: best.id, dial: best.getAttribute('data-dial-code')||''} : null;
                        }""",
                        digits,
                    )
                    if pick and pick.get("id"):
                        item = page.locator(f'#{pick["id"]}').first
                        await item.scroll_into_view_if_needed(timeout=2000)
                        await item.click()  # real click → v18 selects the country
                        selected_dial = pick.get("dial") or ""
                        await page.wait_for_timeout(250)
                    else:
                        await page.keyboard.press("Escape")  # close if no match
            except Exception:
                selected_dial = ""

            # 2) Type the number into the input. If a country was selected, type
            #    only the NATIONAL part (the dial code is shown separately);
            #    otherwise type the full E.164 so the widget can infer it.
            national = digits[len(selected_dial):] if selected_dial and digits.startswith(selected_dial) else digits
            to_type = national if selected_dial else value
            await loc.click()
            await page.wait_for_timeout(120)
            try:
                await loc.press("ControlOrMeta+a")
                await loc.press("Delete")
                for _ in range(8):
                    await loc.press("Backspace")
            except Exception:
                try:
                    await loc.fill("")
                except Exception:
                    pass
            for ch in to_type:
                await page.keyboard.type(ch, delay=random.randint(30, 70))
            await page.wait_for_timeout(250)
            try:
                post = await loc.evaluate(
                    """(el) => {
                        const wrap = el.closest('.iti');
                        const f = wrap && wrap.querySelector('.iti__selected-country, .iti__selected-flag');
                        const aria = f ? (f.getAttribute('aria-label') || f.title || '') : '';
                        const flagDiv = wrap && wrap.querySelector('.iti__selected-country .iti__flag, .iti__selected-flag .iti__flag');
                        return { val: el.value || '', aria, flagCls: flagDiv ? flagDiv.className : '' };
                    }""")
            except Exception:
                post = {}
            logger.info(
                "careerops.phone_fill", selector=sel, dial=selected_dial,
                typed=to_type, post_val=post.get("val"), post_country=post.get("aria"),
                flag_cls=post.get("flagCls"),
            )
            return True
        except Exception as exc:
            logger.warning("careerops.phone_fill_error", selector=sel, error=str(exc)[:160])
            continue
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
    """
    Render the resume to a PDF and upload it via the file input, then VERIFY the
    browser actually registered a file (some forms match a wrong/empty input or
    re-render the widget, leaving "Resume is required").  Returns True only when
    the input ends up holding a file.
    """
    tmp_path = _render_resume_pdf(resume_text)
    try:
        loc = page.locator(selector).first
        await loc.set_input_files(tmp_path)
        await page.wait_for_timeout(1500)
        try:
            files = await loc.evaluate("el => (el.files && el.files.length) || 0")
        except Exception:
            files = 1  # can't introspect (detached) — assume it took
        if not files:
            return False
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


def _pick_answer(
    label: str,
    options: list[str],
    eligibility: Optional[dict] = None,
    job_country: str = "",
) -> Optional[str]:
    """
    Choose the best option text for a screening/EEO question, given its label.

    Work-authorization, visa-sponsorship and relocation answers are derived from
    the candidate's eligibility profile and the job's country (Phase 1) — never a
    blanket "US authorized". Demographic/EEO questions decline to self-identify.
    Returns None when no option fits.
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
        if _elig.work_authorized(eligibility, job_country):
            return find("yes") or (options[1] if len(options) > 1 else None)
        # Honest "no" — never claim authorization we cannot back up.
        return find("no, i am not", "no, i'm not", "no") or (options[0] if options else None)
    if any(k in L for k in ["sponsor", "visa", "immigration support"]):
        if _elig.requires_sponsorship(eligibility):
            return find("yes, i", "yes") or (options[0] if options else None)
        return find("no, i do not", "no, i will not", "no") or (options[1] if len(options) > 1 else None)
    if "relocat" in L:
        if _elig.willing_to_relocate(eligibility):
            return find("yes", "willing") or (options[1] if len(options) > 1 else None)
        return find("no") or (options[0] if options else None)
    if "hear about" in L or "how did you find" in L:
        return find("linkedin", "job board", "company website", "online", "other") or (options[1] if len(options) > 1 else None)
    if any(k in L for k in ["acknowledge", "hybrid", "onsite", "on-site", "commute", "comfortable", "willing", "intend to work", "able to work"]):
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


async def _answer_react_selects(
    page: Page,
    eligibility: Optional[dict] = None,
    job_country: str = "",
    answers_sink: Optional[list] = None,
) -> int:
    """
    Answer every required react-select (Greenhouse/modern ATS) combobox by
    opening it, reading the rendered options, and clicking the best match.
    Returns the number of selects answered.  Each applied answer is appended to
    answers_sink (when provided) as {"question", "answer", "source"} for audit.
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
            choice = _pick_answer(label, texts, eligibility, job_country)
            clicked = False
            if choice:
                target = page.locator(f'.select__option:has-text("{choice[:30]}")').first
                if await target.count() > 0:
                    await target.click()
                    answered += 1
                    clicked = True
                    if answers_sink is not None and label:
                        answers_sink.append(
                            {"question": label, "answer": choice, "source": "heuristic"}
                        )
            if not clicked:
                await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)
        except Exception:
            try:
                await page.keyboard.press("Escape")
            except Exception:
                pass
    return answered


_LLM_SYSTEM = (
    "You are completing a job application on behalf of a candidate. "
    "Answer every question truthfully and favorably using the candidate profile. "
    "For multiple-choice questions you MUST return EXACTLY one of the provided "
    "options, copied verbatim. For free-text questions return a concise, "
    "professional answer (a number when a number is asked for; 1-2 sentences "
    "otherwise). "
    "For work-authorization, visa-sponsorship and relocation questions, answer "
    "STRICTLY according to the work-authorization facts given in the candidate "
    "profile — never assume authorization or sponsorship status not stated there. "
    "Demographic / EEO / diversity questions (gender, race, ethnicity, veteran "
    "status, disability, sexual orientation, pronouns): choose the option that "
    "declines to self-identify (e.g. 'Decline to self-identify', 'I don't wish "
    "to answer', 'Prefer not to say'). "
    "For date questions return an ISO date (YYYY-MM-DD); for an availability / "
    "start-date question a date about two weeks from now is sensible. "
    "Respond with ONLY a JSON object mapping each question id to its answer "
    "string. No prose, no markdown."
)


# Keyword groups the deterministic _pick_answer heuristic can resolve in a
# compliance-safe way.  A field whose label matches one of these is answered
# WITHOUT an LLM call (cheaper, and deterministic for compliance-sensitive
# items like EEO/work-authorization); everything else is routed to the LLM.
_STANDARD_Q_KEYWORDS = (
    "authoriz", "eligible to work", "legally authorized", "right to work",
    "sponsor", "visa", "immigration",
    "hear about", "how did you find", "how did you hear", "referral", "referred",
    "acknowledge", "i agree", "i understand", "consent",
    "gender", "race", "ethnic", "sexual orientation", "veteran", "disability",
    "identify", "lgbt", "transgender", "pronoun", "hispanic", "latino",
    "first-generation",
    "former employer", "non-compete", "restrictive covenant", "subject to any agreement",
    "relocat", "commute", "willing to", "able to work", "hybrid", "onsite", "on-site",
    "comfortable", "intend to work",
)

_PLACEHOLDER_OPT_RE = re.compile(r"^\s*(select|choose|please|--|\.\.\.)", re.I)


def _is_standard_question(label: str) -> bool:
    return any(k in (label or "").lower() for k in _STANDARD_Q_KEYWORDS)


def _clean_options(options: list[str]) -> list[str]:
    """Drop placeholder-ish options ('Select…', 'Choose…', '--') from a list."""
    return [o for o in (options or []) if o and not _PLACEHOLDER_OPT_RE.match(o.strip())]


async def _count_required_empty(page: Page) -> int:
    """
    Count visible required fields that are STILL empty across every control
    type (text/select/native-select/react-select/radio/checkbox).  Logged
    before submit purely to measure fill coverage.  Returns -1 on error.
    """
    try:
        return await page.evaluate(r"""() => {
            let n = 0;
            document.querySelectorAll('input, textarea, select').forEach(e => {
                if (e.offsetParent === null) return;
                // Skip react-select internal comboboxes — their <input> value is
                // always '' even when answered (the value lives in
                // .select__single-value); counted via .select__container below.
                if (e.getAttribute('role') === 'combobox') return;
                const t = (e.type || '').toLowerCase();
                if (['hidden','submit','button','file','image','reset'].includes(t)) return;
                const req = e.required || e.getAttribute('aria-required') === 'true';
                if (!req) return;
                if (t === 'checkbox') { if (!e.checked) n++; return; }
                if (t === 'radio') return;  // counted via groups below
                if (e.tagName === 'SELECT') {
                    const o = e.options[e.selectedIndex];
                    if (!e.value || (o && o.disabled)) n++;
                    return;
                }
                if (!e.value || !e.value.trim()) n++;
            });
            document.querySelectorAll('.select__container').forEach(c => {
                const inp = c.querySelector('input[role=combobox]');
                if (!inp || inp.offsetParent === null) return;
                if (inp.getAttribute('aria-required') !== 'true') return;
                if (!c.querySelector('.select__single-value, .select__multi-value')) n++;
            });
            const seen = {};
            document.querySelectorAll('input[type=radio]').forEach(r => {
                if (r.offsetParent === null) return;
                const rg = r.closest('[role=radiogroup], fieldset');
                const req = r.required || r.getAttribute('aria-required') === 'true'
                    || (rg && rg.getAttribute('aria-required') === 'true');
                if (!req) return;
                const name = r.name || '';
                const gk = name || ('__' + n);
                if (seen[gk]) return; seen[gk] = true;
                const group = name
                    ? Array.from(document.querySelectorAll('input[type=radio]')).filter(x => x.name === name)
                    : [r];
                if (!group.some(g => g.checked)) n++;
            });
            return n;
        }""")
    except Exception:
        return -1


async def _collect_unanswered_required(page: Page) -> list[dict]:
    """
    Gather EVERY still-empty required field after the heuristic pass, tagging
    each interactable element with a stable `data-cops-fid` marker so the answer
    can be committed later regardless of whether it has an id.

    Field kinds returned:
      select        — react-select combobox still on placeholder
      autocomplete  — Greenhouse Country / Location react-select combobox
      native_select — native <select> still on its placeholder option
      text          — text/email/tel/url/number/date <input> or <textarea>
      radio         — radio group (required) with nothing selected

    For react-selects we open each once to capture its options.
    """
    base = await page.evaluate(r"""() => {
        const out = [];
        let i = 0;
        const mark = (el) => { const id = 'f' + (i++); try { el.setAttribute('data-cops-fid', id); } catch (e) {} return id; };
        const lab = (el, container) => {
            let t = '';
            if (el.labels && el.labels[0]) t = el.labels[0].innerText;
            if (!t && el.getAttribute && el.getAttribute('aria-label')) t = el.getAttribute('aria-label');
            if (!t && el.getAttribute && el.getAttribute('aria-labelledby')) {
                const ref = document.getElementById(el.getAttribute('aria-labelledby').split(' ')[0]);
                if (ref) t = ref.innerText;
            }
            if (!t && el.placeholder) t = el.placeholder;
            if (!t && container) { const l = container.querySelector('legend, label'); if (l) t = l.innerText; }
            return (t || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        };

        // 1) react-select comboboxes still on placeholder (incl. Country/Location)
        document.querySelectorAll('.select__container').forEach(c => {
            const inp = c.querySelector('input[role=combobox]');
            if (!inp || inp.offsetParent === null) return;
            const isLoc = inp.id === 'country' || inp.id === 'candidate-location';
            const required = inp.getAttribute('aria-required') === 'true';
            const answered = c.querySelector('.select__single-value, .select__multi-value');
            if ((required || isLoc) && !answered) {
                const key = mark(inp);
                out.push({ key, kind: isLoc ? 'autocomplete' : 'select', fieldId: inp.id || '', label: lab(inp, c) });
            }
        });

        // 2) native <select> elements (required, still on placeholder/empty)
        document.querySelectorAll('select').forEach(s => {
            if (s.offsetParent === null) return;
            if (s.getAttribute('role') === 'combobox') return;
            const required = s.required || s.getAttribute('aria-required') === 'true';
            if (!required) return;
            const o = s.options[s.selectedIndex];
            const ph = !s.value || (o && (o.disabled || /^(\s*|select\b.*|choose\b.*|--.*)$/i.test((o.text || '').trim())));
            if (!ph) return;
            const key = mark(s);
            const options = Array.from(s.options).map(x => (x.text || '').trim()).filter(Boolean);
            out.push({ key, kind: 'native_select', fieldId: s.id || '', label: lab(s), options });
        });

        // 3) text-like inputs + textareas (required, empty) — ANY id, not just question_*
        document.querySelectorAll('input, textarea').forEach(e => {
            if (e.offsetParent === null) return;
            if (e.getAttribute('role') === 'combobox') return;
            const t = (e.type || 'text').toLowerCase();
            if (['hidden','submit','button','file','checkbox','radio','image','reset','range','color'].includes(t)) return;
            const required = e.required || e.getAttribute('aria-required') === 'true';
            if (!required) return;
            if (e.value && e.value.trim()) return;
            const key = mark(e);
            out.push({ key, kind: 'text', inputType: t, fieldId: e.id || '', label: lab(e) });
        });

        // 4) radio groups (required, none selected)
        const seen = {};
        document.querySelectorAll('input[type=radio]').forEach(r => {
            if (r.offsetParent === null) return;
            const rg = r.closest('[role=radiogroup], fieldset');
            const name = r.name || '';
            const group = name
                ? Array.from(document.querySelectorAll('input[type=radio]')).filter(x => x.name === name)
                : [r];
            const required = group.some(g => g.required || g.getAttribute('aria-required') === 'true')
                || (rg && rg.getAttribute('aria-required') === 'true');
            if (!required) return;
            const gk = name || ('__' + i);
            if (seen[gk]) return; seen[gk] = true;
            if (group.some(g => g.checked)) return;
            const options = group.map(g => {
                let lt = '';
                if (g.labels && g.labels[0]) lt = g.labels[0].innerText;
                if (!lt && g.getAttribute('aria-label')) lt = g.getAttribute('aria-label');
                if (!lt) lt = g.value || '';
                return (lt || '').replace(/\s+/g, ' ').trim().slice(0, 90);
            }).filter(Boolean);
            const wrap = rg || r.parentElement || r;
            const key = mark(wrap);
            let glabel = '';
            if (rg) { const lg = rg.querySelector('legend, label'); if (lg) glabel = lg.innerText; }
            out.push({ key, kind: 'radio', label: (glabel || options.join(' / ')).replace(/\s+/g, ' ').trim().slice(0, 160), options });
        });

        return out;
    }""")
    # Capture options for each unanswered react-select by opening it briefly.
    for f in base:
        if f.get("kind") != "select":
            continue
        try:
            await page.locator(f'[data-cops-fid="{f["key"]}"]').first.click()
            await page.wait_for_timeout(350)
            opts = page.locator(".select__option")
            oc = await opts.count()
            texts = []
            for k in range(min(oc, 40)):
                try:
                    texts.append((await opts.nth(k).inner_text()).strip())
                except Exception:
                    pass
            f["options"] = texts
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(120)
        except Exception:
            f["options"] = []
            try:
                await page.keyboard.press("Escape")
            except Exception:
                pass
    return base


async def _commit_field(page: Page, field: dict, answer: str) -> bool:
    """
    Commit `answer` to a collected field and re-verify it is no longer empty.
    Returns True only when the field now holds a value.  Field kinds:
      text          — fill the input/textarea
      native_select — select_option by label (then partial-text fallback)
      select        — open react-select, click the matching .select__option
      autocomplete  — type into the combobox, pick the first suggestion
      radio         — click the option label/input inside the group wrapper
    """
    kind = field.get("kind")
    sel = f'[data-cops-fid="{field.get("key")}"]'
    ans = (answer or "").strip()
    if not ans:
        return False
    try:
        if kind == "text":
            loc = page.locator(sel).first
            await loc.fill(ans)
            try:
                v = await loc.input_value()
            except Exception:
                v = ans
            return bool(v and v.strip())

        if kind == "native_select":
            loc = page.locator(sel).first
            try:
                await loc.select_option(label=ans)
            except Exception:
                opt_val = await loc.evaluate(
                    "(s, a) => { const al = a.trim().toLowerCase();"
                    " const o = Array.from(s.options).find(o => o.text.trim().toLowerCase() === al)"
                    " || Array.from(s.options).find(o => o.text.trim().toLowerCase().includes(al));"
                    " return o ? o.value : null; }",
                    ans,
                )
                if opt_val is None:
                    return False
                await loc.select_option(value=opt_val)
            try:
                return bool(await loc.input_value())
            except Exception:
                return True

        if kind in ("select", "autocomplete"):
            loc = page.locator(sel).first
            await loc.click()
            await page.wait_for_timeout(350)
            if kind == "autocomplete":
                await loc.fill(ans)
                await page.wait_for_timeout(900)
            target = page.locator(f'.select__option:has-text("{ans[:30]}")').first
            clicked = False
            if await target.count() > 0:
                await target.click()
                clicked = True
            else:
                opt = page.locator(".select__option").first
                if await opt.count() > 0:
                    await opt.click()
                    clicked = True
                else:
                    await page.keyboard.press("Escape")
            await page.wait_for_timeout(150)
            return clicked

        if kind == "radio":
            wrap = page.locator(sel).first
            target = wrap.locator(f'label:has-text("{ans[:40]}")').first
            if await target.count() > 0:
                await target.click()
                return True
            rb = wrap.locator('input[type=radio]').first
            if await rb.count() > 0:
                await rb.check(timeout=1500)
                return True
            return False
    except Exception:
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass
        return False
    return False


async def _fill_unanswered_required(
    page: Page, user_data: dict, answers_sink: Optional[list] = None
) -> dict:
    """
    Fill every still-empty required field, committing and re-verifying each.

    Two tiers (mirrors the react-select design):
      1. Deterministic, compliance-safe heuristics (_pick_answer) for standard
         questions (work-auth/sponsorship/EEO/consent/etc.) and for the
         Country/Location autocompletes — no LLM call.
      2. A SINGLE batched LLM call for everything else (job-specific screeners,
         free-text, dates) — gpt-4o-mini, one request per job.

    Work-auth/sponsorship/relocation answers (both tiers) are derived from the
    candidate's eligibility profile and the job's country — never a blanket "US
    authorized".  Applied answers are appended to answers_sink for audit.

    Returns {"heuristic": n, "llm": n, "asked": n}.  Best-effort: any error is
    swallowed (submission stays gated by _verify_submitted).
    """
    eligibility = user_data.get("eligibility")
    job_country = user_data.get("job_country", "")
    stats = {"heuristic": 0, "llm": 0, "asked": 0}
    try:
        fields = await _collect_unanswered_required(page)
    except Exception:
        return stats
    if not fields:
        return stats

    remaining: list[dict] = []
    # ── Tier 1: deterministic ────────────────────────────────────────────────
    for f in fields:
        kind = f.get("kind")
        label = f.get("label", "")
        committed = False
        try:
            if kind == "autocomplete":
                fid_attr = (f.get("fieldId") or "").lower()
                if "country" in fid_attr or "country" in label.lower():
                    committed = await _fill_autocomplete(
                        page, f.get("fieldId") or "country",
                        user_data.get("country") or "United States",
                    )
                else:
                    # Location: robust geocomplete with real-city fallbacks.
                    committed = await _fill_location_autocomplete(
                        page, f.get("fieldId") or "candidate-location",
                        user_data.get("location", ""),
                    )
            elif kind in ("select", "native_select", "radio") and _is_standard_question(label):
                opts = _clean_options(f.get("options") or [])
                if opts:
                    choice = _pick_answer(label, opts, eligibility, job_country)
                    if choice:
                        committed = await _commit_field(page, f, choice)
                        if committed and answers_sink is not None and label:
                            answers_sink.append(
                                {"question": label, "answer": choice, "source": "heuristic"}
                            )
        except Exception:
            committed = False
        if committed:
            stats["heuristic"] += 1
        else:
            remaining.append(f)

    # ── Tier 2: one batched LLM call for the rest ────────────────────────────
    llm_fields = [f for f in remaining if f.get("label")][:18]
    if not (_LLM_AVAILABLE and llm_fields):
        logger.info("careerops.fill_unanswered", **stats)
        return stats
    api_key = getattr(_settings, "openai_api_key", "") or ""
    if not api_key:
        logger.info("careerops.fill_unanswered", **stats)
        return stats

    stats["asked"] = len(llm_fields)
    first = user_data.get("first_name", "")
    last = user_data.get("last_name", "")
    authorized = sorted({c for c in (eligibility or {}).get("authorized_countries", []) if c})
    auth_line = (
        f"Authorized to work in: {', '.join(authorized)}. " if authorized
        else "No work authorization on file. "
    )
    if job_country:
        auth_line += (
            f"For this {job_country} role the candidate IS authorized to work. "
            if _elig.work_authorized(eligibility, job_country)
            else f"For this {job_country} role the candidate is NOT authorized to work. "
        )
    spons_line = (
        "Requires visa sponsorship. " if _elig.requires_sponsorship(eligibility)
        else "Does NOT require visa sponsorship. "
    )
    reloc_line = (
        "Willing to relocate. " if _elig.willing_to_relocate(eligibility)
        else "Not willing to relocate. "
    )
    profile = (
        f"Candidate: {first} {last}\n"
        f"Email: {user_data.get('email','')}\n"
        f"Location: {user_data.get('location','')}\n"
        f"Work authorization (answer auth/sponsorship/relocation questions STRICTLY "
        f"per these facts): {auth_line}{spons_line}{reloc_line}\n"
        f"Resume:\n{(user_data.get('resume_text','') or '')[:1400]}"
    )
    questions = []
    for f in llm_fields:
        q = {"id": f["key"], "question": f["label"], "type": f["kind"]}
        opts = _clean_options(f.get("options") or [])
        if opts:
            q["options"] = opts
        questions.append(q)
    prompt = (
        f"{profile}\n\nAnswer these application questions as JSON "
        f'(object of id -> answer):\n{json.dumps(questions, ensure_ascii=False)}'
    )
    try:
        raw = await asyncio.wait_for(
            _call_openai(prompt, _LLM_SYSTEM, api_key, max_tokens=900), timeout=25
        )
    except Exception as exc:
        logger.warning("careerops.llm_call_failed", error=str(exc))
        logger.info("careerops.fill_unanswered", **stats)
        return stats

    answers: dict = {}
    try:
        answers = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                answers = json.loads(m.group(0))
            except Exception:
                answers = {}
    if isinstance(answers, dict):
        by_key = {f["key"]: f for f in llm_fields}
        for fid, ans in answers.items():
            f = by_key.get(fid)
            if not f or ans is None:
                continue
            try:
                if await _commit_field(page, f, str(ans)):
                    stats["llm"] += 1
                    if answers_sink is not None and f.get("label"):
                        answers_sink.append(
                            {"question": f["label"], "answer": str(ans), "source": "llm"}
                        )
            except Exception:
                pass

    logger.info("careerops.fill_unanswered", **stats)
    return stats


async def _autocomplete_answered(page: Page, field_id: str) -> bool:
    """True if the given Country/Location combobox now shows a selected value."""
    try:
        return await page.evaluate(
            "(fid) => { const inp = document.getElementById(fid);"
            " if (!inp) return false; const c = inp.closest('.select__container');"
            " if (!c) return !!(inp.value && inp.value.trim());"
            " return !!c.querySelector('.select__single-value, .select__multi-value'); }",
            field_id,
        )
    except Exception:
        return False


async def _fill_autocomplete(page: Page, field_id: str, value: str) -> bool:
    """
    Fill a Greenhouse autocomplete combobox (Country / Location) by TYPING (so
    the async geo/suggestion lookup fires) then clicking the first suggestion.
    Returns True ONLY when a value is actually selected (verified) — the old
    version pressed Enter and returned True even when nothing matched, which left
    required Location fields silently empty and blocked submission.
    """
    try:
        inp = page.locator(f'#{field_id}').first
        if await inp.count() == 0 or not value:
            return False
        await inp.click()
        await inp.fill("")
        await inp.type(value, delay=20)
        await page.wait_for_timeout(1100)
        opt = page.locator('.select__option').first
        if await opt.count() > 0:
            await opt.click()
            await page.wait_for_timeout(200)
            return await _autocomplete_answered(page, field_id)
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass
        return False
    except Exception:
        return False


async def _fill_location_autocomplete(page: Page, field_id: str, preferred: str) -> bool:
    """
    Fill a Greenhouse "Location (City)" geocomplete robustly.  Users' stored
    location is often non-geocodable ("USA REMOTE", "USA", "Remote"), which
    matches no suggestion and leaves this REQUIRED field empty — the single
    biggest production blocker.  Try the user's value only if it looks like a
    real place, then progressively more concrete fallbacks, stopping as soon as a
    suggestion is selected.
    """
    if await _autocomplete_answered(page, field_id):
        return True
    candidates: list[str] = []
    p = (preferred or "").strip()
    generic = {"usa remote", "usa", "remote", "us", "united states",
               "remote usa", "usa, remote", "remote, usa", "anywhere"}
    if p and p.lower() not in generic:
        candidates.append(p)
    candidates += [
        "New York, NY, United States",
        "San Francisco, CA, United States",
        "Remote",
        "United States",
    ]
    for val in candidates:
        if await _fill_autocomplete(page, field_id, val):
            return True
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
    """
    Tick any unchecked checkboxes (consent / acknowledgement gates), including
    custom ARIA checkbox widgets (div/span role=checkbox) that aren't backed by
    a real <input> and so are missed by the input[type=checkbox] pass.
    """
    boxes = page.locator('input[type="checkbox"]')
    try:
        n = await boxes.count()
    except Exception:
        n = 0
    for i in range(n):
        b = boxes.nth(i)
        try:
            if not await b.is_checked():
                await b.check(timeout=1500)
        except Exception:
            pass
    # Custom ARIA checkbox widgets not backed by an <input type=checkbox>.
    try:
        widgets = page.locator('[role="checkbox"][aria-checked="false"]')
        wn = await widgets.count()
    except Exception:
        wn = 0
    for i in range(min(wn, 20)):
        try:
            w = widgets.nth(i)
            if await w.is_visible():
                await w.click(timeout=1500)
        except Exception:
            pass


# Greenhouse's verification email reads:
#   "Copy and paste this code into the security code field on your
#    application: R2JpYKXl  After you enter the code, resubmit your application."
# Codes are 6–12 mixed-case alphanumerics (not plain 6-digit numbers), so we
# anchor on the surrounding phrasing and prefer a token that mixes letters and
# digits — which also avoids capturing ordinary English words.
_CODE_PATTERNS = [
    re.compile(r"code\s+field\s+on\s+your\s+application[:\s]+([A-Za-z0-9]{6,12})", re.I),
    re.compile(r"(?:security|verification)\s+code\s+(?:is\b|:)[\s:]*([A-Za-z0-9]{6,12})", re.I),
    re.compile(r"\bcode[:\s]+([A-Za-z0-9]{6,12})\b", re.I),
    re.compile(r"application[:\s]*([A-Za-z0-9]{6,12})", re.I),  # legacy fallback
]


def _extract_security_code(text: str) -> Optional[str]:
    """
    Extract a Greenhouse email security code from a (HTML-stripped) email body.
    Prefers a letter+digit mixed token (the real code format) over a purely
    numeric/alpha match.  Returns None when no plausible code is present.
    """
    if not text:
        return None
    flat = re.sub(r"\s+", " ", text)
    candidates: list[str] = []
    for pat in _CODE_PATTERNS:
        candidates.extend(m.group(1) for m in pat.finditer(flat))
    if not candidates:
        return None
    for tok in candidates:
        if any(c.isdigit() for c in tok) and any(c.isalpha() for c in tok):
            return tok
    return candidates[0]


async def _poll_greenhouse_code(
    email: str, company: str, resend_key: str, since_iso: str,
    attempts: int = 14, delay: float = 4.0,
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
    company_key = company.lower()[:6]
    async with httpx.AsyncClient(timeout=15, headers=headers) as client:
        for _ in range(attempts):
            await asyncio.sleep(delay)
            try:
                r = await client.get("https://api.resend.com/emails/inbound", params={"limit": 50})
                rows = r.json().get("data", []) if r.status_code == 200 else []
            except Exception:
                continue
            # Collect candidate security-code emails for this inbox in the
            # window.  We PREFER one whose subject names the company, but fall
            # back to the most recent — Greenhouse subjects sometimes use a brand
            # name that differs from our company string (e.g. Intercom's code
            # email reads "...to Fin"), which previously caused false misses.
            # Applications run sequentially and we poll right after submitting,
            # so the most recent code email in the window is reliably ours.
            candidates = []
            for m in rows:
                to = ",".join(m.get("to") or []).lower()
                frm = (m.get("from") or "").lower()
                subj = (m.get("subject") or "").lower()
                created = m.get("created_at", "")
                if email.lower() not in to:
                    continue
                # Match the security-code email by SUBJECT + recipient + recency.
                # We no longer require "greenhouse" in the From address: Greenhouse
                # sends these codes from varying/branded sender domains (a real
                # false-miss source). The subject is the stable signal, and code
                # extraction below validates an actual code token is present, so a
                # stray non-code email won't be mistaken for one.
                is_code_subject = (
                    "security code" in subj
                    or "verification code" in subj
                    or ("code" in subj and "application" in subj)
                )
                if not is_code_subject:
                    continue
                if since_iso and created < since_iso:
                    continue  # stale (from a previous attempt)
                candidates.append((created, subj, m))
            if not candidates:
                continue
            candidates.sort(key=lambda c: c[0], reverse=True)  # newest first
            matched = [c for c in candidates if company_key and company_key in c[1]]
            rest = [c for c in candidates if not (company_key and company_key in c[1])]
            for _created, _subj, m in matched + rest:
                try:
                    rd = await client.get(f"https://api.resend.com/emails/inbound/{m['id']}")
                    body = rd.json()
                    html = body.get("html") or body.get("text") or ""
                except Exception:
                    continue
                code = _extract_security_code(re.sub(r"<[^>]+>", " ", html))
                if code:
                    return code
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
    #
    # The code step often renders a few seconds AFTER the first submit, so poll
    # for the field to appear (up to ~15 s) before concluding it is absent.
    # Checking only once was a major cause of false "unconfirmed" results: we saw
    # no field, gave up, and reported the application as failed even though
    # Greenhouse was about to ask for the code (the honest gate stays intact —
    # we still only report success after the code is entered and confirmed).
    boxes = page.locator('input[id^="security-input-"]')
    single = None
    n_boxes = 0
    for _attempt in range(8):  # ~15 s total
        # The confirmation page sometimes renders a few seconds after the first
        # submit (no code step at all). Re-check before concluding the code field
        # is simply slow — this rescues "submit_unconfirmed" cases where the
        # application actually went through but the thank-you was late to paint.
        if await _verify_submitted(page):
            return True
        try:
            n_boxes = await boxes.count()
        except Exception:
            n_boxes = 0
        if n_boxes > 0:
            break
        for sel in ['input#security_code', 'input[name*="security"]',
                    'input[aria-label*="ecurity code"]']:
            loc = page.locator(sel).first
            try:
                if await loc.count() > 0 and await loc.is_visible():
                    single = loc
                    break
            except Exception:
                pass
        if single is not None:
            break
        await page.wait_for_timeout(1900)
    if n_boxes == 0 and single is None:
        return False  # no security-code field present after waiting

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
            args=[
                "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                # Reduce automation fingerprinting (helps avoid soft bot-blocks on
                # Greenhouse/Lever). NOTE: not enough for Ashby, whose SPA stays
                # un-hydrated headless — that needs a headful/Xvfb browser (post-resize).
                "--disable-blink-features=AutomationControlled",
            ],
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
        # Light stealth: hide the headless/automation tells most ATS check for.
        await self.context.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
            "Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});"
            "Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});"
            "window.chrome={runtime:{}};"
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
            if not await _fill_phone(page, user_data.get("phone", "")):
                await _fill(page, "#phone", user_data.get("phone", ""))
            # Preferred First Name is a standard #preferred_name input (not a
            # question_* id) and is required on many boards — fill it directly.
            await _fill(page, "#preferred_name", first)

            # Country / Location autocomplete comboboxes.  Location uses the
            # robust geocomplete filler (user location is often non-geocodable
            # junk like "USA REMOTE" — fall back to a real city so the REQUIRED
            # "Location (City)" field gets a value).
            await _fill_autocomplete(page, "country", user_data.get("country", "") or "United States")
            await _fill_location_autocomplete(
                page, "candidate-location", user_data.get("location", ""),
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

            # Resume (real PDF).  Try resume-named inputs first and VERIFY the
            # file attached; only fall back to a bare file input if needed.
            # This fixes "Resume/CV is required" misses where the first matching
            # input was the wrong one or the widget re-rendered.
            resume_text = user_data.get("resume_text", "")
            if resume_text:
                uploaded = False
                for sel in [
                    'input[type="file"][name*="resume" i]',
                    'input[type="file"][id*="resume" i]',
                    'input[type="file"][aria-label*="resume" i]',
                    'input[type="file"][name*="cv" i]',
                    'input[type="file"][accept*="pdf"]',
                    'input[type="file"]',
                ]:
                    if await page.locator(sel).count() > 0:
                        if await _upload_resume(page, sel, resume_text):
                            uploaded = True
                            break
                if not uploaded:
                    logger.warning("careerops.greenhouse.resume_not_attached", url=job_url)

            # Cover letter (text field if present).
            cover_letter = user_data.get("cover_letter", "")
            for sel in ['textarea[name*="cover"]', 'textarea[id*="cover"]', '#cover_letter']:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            # Screening / EEO react-select questions + consent checkboxes.
            # Honest answers (work-auth/sponsorship/relocation) come from the
            # eligibility profile + the job's country; every applied answer is
            # collected for audit logging into ApplicationEvent.
            eligibility = user_data.get("eligibility")
            job_country = user_data.get("job_country", "")
            screening_answers: list = []
            answered = await _answer_react_selects(
                page, eligibility, job_country, screening_answers
            )
            await _check_required_boxes(page)
            # Broadened fill: every still-empty required field (native selects,
            # radios, broader text/textarea, dates, autocompletes) — heuristics
            # for compliance-safe standards, one batched LLM call for the rest.
            #
            # Retried (≤3 passes): the LLM tier is non-deterministic and some
            # required fields only render after earlier ones are answered, so a
            # SINGLE pass frequently left exactly one straggler empty — the
            # dominant cause of "submission not confirmed (required fields)".
            # We re-run the fill+checkbox pass while required fields remain AND
            # each pass keeps resolving at least one (stop on no-progress so we
            # never loop on a field that genuinely can't be answered).
            fill_stats = {"heuristic": 0, "llm": 0, "asked": 0, "passes": 0}
            required_empty = -1
            for _pass in range(3):
                stats = await _fill_unanswered_required(page, user_data, screening_answers)
                await _check_required_boxes(page)  # re-tick consent boxes revealed while filling
                for k in ("heuristic", "llm", "asked"):
                    fill_stats[k] += stats.get(k, 0)
                fill_stats["passes"] += 1
                new_empty = await _count_required_empty(page)
                if new_empty == 0:
                    required_empty = 0
                    break
                # Stop once a pass stops making progress (or the count errored).
                if required_empty >= 0 and (new_empty < 0 or new_empty >= required_empty):
                    required_empty = new_empty
                    break
                required_empty = new_empty
            logger.info(
                "careerops.greenhouse.filled",
                url=job_url,
                selects_answered=answered,
                heuristic_filled=fill_stats.get("heuristic", 0),
                llm_filled=fill_stats.get("llm", 0),
                llm_asked=fill_stats.get("asked", 0),
                fill_passes=fill_stats.get("passes", 1),
                required_empty_before_submit=required_empty,
            )

            # Close any react-select menu still open from the last fill (an open
            # dropdown overlay can intercept the submit click and silently no-op,
            # leaving the form un-submitted with no code step) and bring the
            # button into view before clicking.
            try:
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(250)
            except Exception:
                pass
            submit = page.locator('input[type="submit"], button[type="submit"]').first
            if await submit.count() > 0:
                company = (user_data.get("_company") or "").strip()
                # Submit with a guarded single retry. On the modern embedded React
                # form the first click sometimes no-ops (a late re-render or an
                # overlay swallows it) → "submission not confirmed" with the form
                # still fully filled (required_empty=0). We retry ONLY while the
                # submit control is still present/visible, which proves the form
                # was NOT consumed — so there is no double-submit risk.
                for _attempt in range(2):
                    try:
                        await submit.scroll_into_view_if_needed(timeout=3000)
                    except Exception:
                        pass
                    try:
                        await submit.click()
                    except Exception:
                        break
                    try:
                        await page.wait_for_load_state("networkidle", timeout=12000)
                    except Exception:
                        pass
                    if await _verify_submitted(page):
                        logger.info("careerops.greenhouse.submitted", url=job_url)
                        return {"status": "submitted", "url": job_url, "ats": "greenhouse",
                                "answers": screening_answers}

                    # Greenhouse email-verification step: a security-code field
                    # appears and a code is emailed to the applicant. Fetch it from
                    # the inbox, enter it, and resubmit to finalize the application.
                    if await _complete_greenhouse_verification(
                        page, user_data.get("email", ""), company,
                    ):
                        logger.info("careerops.greenhouse.submitted_after_code", url=job_url)
                        return {"status": "submitted", "url": job_url, "ats": "greenhouse",
                                "answers": screening_answers}

                    # Not confirmed. If the submit control is gone the form was
                    # consumed (don't re-click); otherwise the click was likely a
                    # no-op — re-tick boxes and retry once.
                    try:
                        still_there = await submit.count() > 0 and await submit.is_visible()
                    except Exception:
                        still_there = False
                    if not still_there:
                        break
                    await _check_required_boxes(page)
                    await page.wait_for_timeout(1500)

                # Diagnostics: capture WHY this didn't confirm so the failure mode
                # is actionable (which required field is stuck / what the page shows
                # post-submit) instead of an opaque "not confirmed".
                try:
                    stuck = await _collect_unanswered_required(page)
                    stuck_desc = [f"{f.get('kind')}:{(f.get('label') or '')[:40]}" for f in stuck][:8]
                except Exception:
                    stuck_desc = []
                try:
                    diag = await page.evaluate(r"""() => {
                        const sb = document.querySelector('input[type=submit], button[type=submit]');
                        const body = (document.body.innerText || '').toLowerCase();
                        const errEls = Array.from(document.querySelectorAll(
                            '[aria-invalid=true], .error, [class*=error i], [role=alert]'))
                            .map(e => (e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0, 6);
                        const ph = document.querySelector('#phone, input[type=tel]');
                        let phoneVal = '', phoneCountry = '', phoneHtml = '';
                        if (ph) {
                            phoneVal = ph.value || '';
                            try {
                                const g = window.intlTelInputGlobals;
                                const iti = g && g.getInstance ? g.getInstance(ph) : null;
                                if (iti && iti.getSelectedCountryData)
                                    phoneCountry = (iti.getSelectedCountryData() || {}).iso2 || '';
                            } catch (e) {}
                            // Capture the WRAPPER + flag button + a sample country
                            // <li> so we can write a precise country-dropdown selector.
                            const wrap = ph.closest('.iti') || ph.parentElement;
                            const flag = wrap && wrap.querySelector(
                                '.iti__selected-flag, .iti__selected-country, [class*=selected-flag i], [role=combobox]');
                            const liAu = document.querySelector(
                                'li[data-country-code=au], li[data-dial-code="61"], .iti__country[data-country-code=au]');
                            const anyLi = document.querySelector('.iti__country, li[data-dial-code]');
                            phoneHtml = [
                                'wrapCls=' + (wrap ? wrap.className : 'NONE'),
                                'flag=' + (flag ? flag.outerHTML.slice(0, 180) : 'NONE'),
                                'auLi=' + (liAu ? liAu.outerHTML.slice(0, 160) : 'NONE'),
                                'anyLi=' + (anyLi ? anyLi.outerHTML.slice(0, 160) : 'NONE'),
                            ].join(' || ').replace(/\s+/g, ' ').slice(0, 760);
                        }
                        return {
                            submitVisible: !!(sb && sb.offsetParent !== null),
                            bodyTail: body.slice(-260),
                            errors: errEls,
                            phoneVal, phoneCountry, phoneHtml,
                        };
                    }""")
                except Exception:
                    diag = {}
                logger.warning(
                    "careerops.greenhouse.submit_unconfirmed",
                    url=job_url,
                    stuck_required=stuck_desc,
                    submit_visible=diag.get("submitVisible"),
                    page_errors=diag.get("errors"),
                    phone_val=diag.get("phoneVal"),
                    phone_country=diag.get("phoneCountry"),
                    phone_html=(diag.get("phoneHtml") or "")[:700],
                    body_tail=(diag.get("bodyTail") or "")[:200],
                )
                return {"status": "error", "url": job_url, "ats": "greenhouse",
                        "error": "submission not confirmed (required fields or email code incomplete)"}

            return {"status": "form_not_found", "url": job_url, "ats": "greenhouse"}
        finally:
            await page.close()

    # ── Lever ────────────────────────────────────────────────────────────────

    async def apply_lever(self, job_url: str, user_data: dict) -> dict:
        """Lever: jobs.lever.co/company/job-id — the /apply route is a fully
        server-rendered form (verified), so go there directly rather than the
        flaky 'click Apply + wait for networkidle' SPA dance."""
        page = await self.context.new_page()
        try:
            apply_url = job_url if job_url.rstrip("/").endswith("/apply") else job_url.rstrip("/") + "/apply"
            await page.goto(apply_url, wait_until="domcontentloaded", timeout=30000)
            try:
                await page.wait_for_selector('input[name="name"], input[name="email"]', timeout=15000)
            except Exception:
                # Fallback for older layouts: posting page then Apply click.
                await page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
                await _click_apply_button(page)
                try:
                    await page.wait_for_selector('input[name="name"], input[name="email"]', timeout=12000)
                except Exception:
                    return {"status": "form_not_found", "url": job_url, "ats": "lever"}
            await page.wait_for_timeout(random.randint(800, 1500))

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
                    'input[type="file"][name*="resume" i]',
                    'input[type="file"][accept*="pdf"]',
                    'input[type="file"]',
                ]:
                    if await page.locator(sel).count() > 0:
                        if await _upload_resume(page, sel, resume_text):
                            break

            cover_letter = user_data.get("cover_letter", "")
            for sel in ['textarea[name*="comments"]', 'textarea[name*="cover"]', 'textarea']:
                if cover_letter and await _fill(page, sel, cover_letter[:2000]):
                    break

            # Custom screening questions (Lever cards[…] fields) + EEO/consent —
            # honest, eligibility-aware answers, collected for audit.
            eligibility = user_data.get("eligibility")
            job_country = user_data.get("job_country", "")
            screening_answers: list = []
            await _check_required_boxes(page)
            await _fill_unanswered_required(page, user_data, screening_answers)
            await _check_required_boxes(page)
            _ = (eligibility, job_country)  # threaded via user_data into the fill

            for txt in ["Submit Application", "Submit"]:
                btn = page.locator(f'button[type="submit"]:has-text("{txt}")').first
                if await btn.count() > 0:
                    try:
                        await btn.scroll_into_view_if_needed(timeout=3000)
                    except Exception:
                        pass
                    await btn.click()
                    try:
                        await page.wait_for_load_state("networkidle", timeout=12000)
                    except Exception:
                        pass
                    if await _verify_submitted(page):
                        logger.info("careerops.lever.submitted", url=job_url)
                        return {"status": "submitted", "url": job_url, "ats": "lever",
                                "answers": screening_answers}
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
            # Ashby is a client-rendered SPA where "networkidle" often never
            # settles (it caused timeouts). Go straight to the /application route
            # and wait for real form inputs to appear instead of network idle.
            if not job_url.rstrip("/").endswith("/application"):
                job_url = job_url.rstrip("/") + "/application"
            await page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
            try:
                await page.wait_for_selector("input, textarea", timeout=20000)
            except Exception:
                # No form yet — try clicking an Apply button, then wait again.
                await _click_apply_button(page)
                try:
                    await page.wait_for_selector("input, textarea", timeout=15000)
                except Exception:
                    pass
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
