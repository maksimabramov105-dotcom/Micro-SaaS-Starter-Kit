"""
eligibility.py — honest work-authorization / sponsorship / location answers.

Phase 1: replaces the old blanket "authorized to work in the US, no visa
sponsorship needed" assumption.  Answers are derived from the candidate's
eligibility profile (threaded from AutoApplyCampaign) and the JOB's country,
so the worker never claims false authorization.

The profile is a plain dict (decoded from the worker payload):
    {
      "authorized_countries": ["United States", "Germany"],  # where they can work
      "needs_visa_sponsorship": false,
      "willing_to_relocate": false,
      "remote_only": true,
      "languages": ["English", "German"],
    }
"""
from __future__ import annotations

import re
from typing import Optional

# Common country spellings/abbreviations → a normalized comparison key.
_COUNTRY_ALIASES = {
    "us": "united states",
    "usa": "united states",
    "u.s.": "united states",
    "u.s.a.": "united states",
    "united states of america": "united states",
    "america": "united states",
    "uk": "united kingdom",
    "u.k.": "united kingdom",
    "great britain": "united kingdom",
    "england": "united kingdom",
    "uae": "united arab emirates",
    "deutschland": "germany",
}


def normalize_country(value: str) -> str:
    """Lowercase, collapse whitespace, and canonicalize common aliases."""
    if not value:
        return ""
    v = " ".join(str(value).strip().lower().split())
    return _COUNTRY_ALIASES.get(v, v)


def work_authorized(eligibility: Optional[dict], job_country: str) -> bool:
    """
    True only when the candidate is authorized to work in the job's country.
    With no profile or no resolvable job country we return False (conservative —
    never claim authorization we cannot back up).
    """
    if not eligibility:
        return False
    jc = normalize_country(job_country)
    if not jc:
        return False
    authorized = {
        normalize_country(c) for c in (eligibility.get("authorized_countries") or [])
    }
    return jc in authorized


def requires_sponsorship(eligibility: Optional[dict]) -> bool:
    """Whether the candidate needs visa sponsorship (honest, profile-driven)."""
    if not eligibility:
        return False
    return bool(eligibility.get("needs_visa_sponsorship"))


def willing_to_relocate(eligibility: Optional[dict]) -> bool:
    if not eligibility:
        return False
    return bool(eligibility.get("willing_to_relocate"))


def remote_only(eligibility: Optional[dict]) -> bool:
    # Default True: safest for an internationally-located candidate (best
    # eligibility + reply rate) until they explicitly opt into on-site.
    if not eligibility:
        return True
    return bool(eligibility.get("remote_only", True))


# ── Hiring-region detection (Phase 2 / targeting_v2) — mirrors lib/eligibility.ts
_REGION_GROUPS = {
    "emea": ["united kingdom", "germany", "france", "spain", "portugal", "netherlands", "ireland", "poland", "romania"],
    "europe": ["united kingdom", "germany", "france", "spain", "portugal", "netherlands", "ireland", "poland", "romania"],
    "eu": ["germany", "france", "spain", "portugal", "netherlands", "ireland", "poland", "romania"],
    "latam": ["brazil", "mexico", "argentina"],
    "apac": ["australia", "singapore", "india", "new zealand"],
    "anz": ["australia", "new zealand"],
}


def detect_hiring_region(text: str):
    """Return {'global': True}, {'countries': [...]}, or None (no signal)."""
    t = " ".join((text or "").lower().split())
    if not t:
        return None
    if re.search(r"\b(work from anywhere|anywhere in the world|worldwide|fully (global|distributed)|globally remote|remote[- ]?global|no location requirement)\b", t):
        return {"global": True}
    if re.search(r"\b(us only|u\.s\. only|usa only|united states only|us[- ]based only|must be (located|based) in the (us|united states)|authorized to work in the (us|united states|u\.s\.?)|us work authorization|\(us\b|\bus[- ]remote\b|remote within the (us|united states))\b", t):
        return {"countries": ["united states"]}
    rg = re.search(r"\b(emea|europe|eu|latam|apac|anz)\b", t)
    if rg and re.search(r"\b(remote|hire|based|located|within|only|region)\b", t):
        return {"countries": _REGION_GROUPS[rg.group(1)]}
    ch = re.search(r"\bremote[, (–-]+(canada|united kingdom|uk|germany|australia|india|ireland|france|netherlands|spain|brazil|mexico|singapore)\b", t)
    if ch:
        return {"countries": [normalize_country(ch.group(1))]}
    if re.search(r"\b(est|edt|pst|pdt|cst|cdt|mst|mdt|us timezone|north american (time|hours)|pacific time|eastern time)\b", t):
        return {"countries": ["united states", "canada"]}
    return None


def extract_seniority(title: str):
    """Numeric ladder (0 intern … 6 VP+); 2 (mid) default; None never returned here."""
    t = (title or "").lower()
    if re.search(r"\b(vp|vice president|head of|chief|c[teio]o)\b", t):
        return 6
    if re.search(r"\b(director|manager|mgr)\b", t):
        return 5
    if re.search(r"\b(staff|principal|lead|architect)\b", t):
        return 4
    if re.search(r"\b(senior|sr\.?)\b", t):
        return 3
    if re.search(r"\b(junior|jr\.?|entry[- ]level|associate)\b", t):
        return 1
    if re.search(r"\b(intern|internship|trainee|graduate|new grad)\b", t):
        return 0
    return 2


def knockout_reason(
    eligibility: Optional[dict],
    job_country: str,
    job_is_remote: bool,
    job_text: str = "",
    targeting_v2: bool = False,
    profile_seniority: Optional[int] = None,
) -> Optional[str]:
    """
    Pre-apply eligibility gate.  Returns a short reason string when the
    candidate should NOT apply (so the caller can skip + log instead of burning
    quota), or None when the application is worth attempting.

    Legacy reasons: "remote_only", "work_auth".
    targeting_v2 adds: "remote_region", "seniority_mismatch".
    """
    relocate_escape = willing_to_relocate(eligibility) and not requires_sponsorship(eligibility)
    authorized = {normalize_country(c) for c in (eligibility or {}).get("authorized_countries", [])}

    if targeting_v2 and profile_seniority is not None and job_text:
        jl = extract_seniority(job_text)
        if jl is not None and abs(jl - profile_seniority) >= 2:
            return "seniority_mismatch"

    if job_is_remote:
        if not targeting_v2:
            return None  # legacy: any remote role passes
        region = detect_hiring_region(job_text)
        if region is None or region.get("global"):
            return None
        overlap = any(normalize_country(c) in authorized for c in region.get("countries", []))
        if overlap or relocate_escape:
            return None
        return "remote_region"

    if remote_only(eligibility):
        return "remote_only"
    jc = normalize_country(job_country)
    if not jc:
        return None  # unknown on-site location — don't skip on uncertainty
    if jc in authorized:
        return None
    if relocate_escape:
        return None
    return "work_auth"
