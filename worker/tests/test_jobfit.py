"""
test_jobfit.py — Unit tests for the Phase 3 deterministic job-fit scorer.
"""
from worker.ai.jobfit import score_job

RESUME = (
    "Senior Python engineer with 8 years building FastAPI services, PostgreSQL, "
    "Docker, Kubernetes, AWS, and Redis. Led backend teams."
)
ELIG_INTL = {
    "authorized_countries": ["Germany"], "needs_visa_sponsorship": True,
    "willing_to_relocate": False, "remote_only": False, "languages": ["English"],
}
ELIG_REMOTE_ONLY = {**ELIG_INTL, "remote_only": True}


def test_strong_match_scores_high():
    job = {"title": "Senior Python Engineer",
           "description": "FastAPI PostgreSQL Docker Kubernetes AWS Redis backend",
           "remote": True, "location": "Remote"}
    out = score_job(RESUME, job, ELIG_INTL, ["English"], "Germany")
    assert out["score"] >= 80
    assert any("skills overlap" in r for r in out["reasons"])
    assert out["breakdown"]["skills"] > 0


def test_poor_match_scores_low():
    job = {"title": "Senior Sales Director",
           "description": "Cold calling, quota attainment, CRM, territory management",
           "remote": False, "location": "New York, NY"}
    out = score_job(RESUME, job, ELIG_REMOTE_ONLY, ["English"], "United States")
    assert out["score"] < 45  # below the default gate


def test_eligibility_knockout_lowers_score():
    job = {"title": "Senior Python Engineer",
           "description": "FastAPI PostgreSQL Docker AWS",
           "remote": False, "location": "Austin, TX"}
    # International profile, US on-site → eligibility component = 0.
    out = score_job(RESUME, job, ELIG_INTL, ["English"], "United States")
    assert out["breakdown"]["eligibility"] == 0
    assert any("eligibility risk" in r for r in out["reasons"])


def test_no_text_at_all_is_neutral_not_zero():
    # No title AND no description (rare) → neutral skills, not zero.
    job = {"title": "", "description": "", "remote": True, "location": "Remote"}
    out = score_job(RESUME, job, ELIG_INTL, ["English"], "Germany")
    assert out["breakdown"]["skills"] == 25
    assert any("no job description" in r for r in out["reasons"])


def test_title_only_still_scores_skills():
    # Greenhouse content=false → empty description but a title still scores.
    job = {"title": "Senior Python Engineer FastAPI", "description": "",
           "remote": True, "location": "Remote"}
    out = score_job(RESUME, job, ELIG_INTL, ["English"], "Germany")
    assert out["breakdown"]["skills"] > 25


def test_score_is_bounded_0_100():
    job = {"title": "Senior Python Engineer FastAPI Docker AWS Kubernetes Redis PostgreSQL",
           "description": RESUME, "remote": True, "location": "Remote"}
    out = score_job(RESUME, job, ELIG_INTL, ["English"], "Germany")
    assert 0 <= out["score"] <= 100
