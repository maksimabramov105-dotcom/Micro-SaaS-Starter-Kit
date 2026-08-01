"""
Quality of the paid Resume Rescue fit report.

Every case here comes from actually buying the product on production
(2026-08-01, order cmsabrgd00004hu3v3msjqoic) and reading what the buyer got:
score 59 for a near-perfect candidate, and six of ten "missing" keywords
demonstrably present in their resume.

The governing rule: a FALSE "missing" is the expensive error. It tells someone
who paid to add something their resume already says — advice they can act on and
be made worse by. A false "present" merely omits a suggestion.
"""
import sys

import pytest

from worker.ai import jobfit
from worker.ai.rescue import _keyword_present

RESUME = """MARCUS DELANEY
Backend engineer with 6 years building payment and billing systems in Python and Go.

Senior Backend Engineer, Kestrel Payments (Mar 2022 - present)
- Rebuilt the settlement pipeline handling 1.2M transactions/day, cutting reconciliation lag from 6h to 11min
- Led migration from a Django monolith to 7 Go services on Kubernetes; p99 latency down 43%
- Designed idempotent webhook ingestion for Stripe and Adyen, eliminating duplicate-charge incidents
- Mentored 4 engineers; ran the on-call rotation and incident reviews

SKILLS
Python, Go, PostgreSQL, Redis, Kafka, Kubernetes, Docker, AWS, Terraform, FastAPI, gRPC, CI/CD, pytest
"""


@pytest.fixture
def matcher():
    tokens = jobfit._tokens(RESUME)
    lower = RESUME.lower()
    return lambda kw: _keyword_present(kw, tokens, lower)


class TestKeywordsTheBuyerAlreadyHad:
    """Each of these was reported missing to a paying customer."""

    def test_hyphenated_term_present_verbatim(self, matcher):
        # "on-call" is in the resume as literal text. It took the single-word
        # path and was looked up in the token set — but _tokens() splits on the
        # hyphen, so it could never match no matter what the resume said.
        assert "on-call" in RESUME.lower()
        assert matcher("on-call") is True

    def test_morphological_variant(self, matcher):
        # Resume says "idempotent"; the posting says "idempotency".
        assert matcher("idempotency") is True

    @pytest.mark.parametrize("kw", ["CI/CD", "ci/cd"])
    def test_slashed_term(self, matcher, kw):
        assert matcher(kw) is True

    def test_plural_and_singular_agree(self, matcher):
        assert matcher("incidents") is True
        assert matcher("engineer") is True


class TestStillHonestlyMissing:
    """Leaning towards 'present' must not become 'always present'."""

    @pytest.mark.parametrize(
        "kw",
        [
            "distributed systems",
            "event-driven architecture",
            "Rust",
            "machine learning",
            "card networks",
        ],
    )
    def test_absent_terms_stay_missing(self, matcher, kw):
        assert matcher(kw) is False

    def test_substring_of_a_longer_word_is_not_a_match(self, matcher):
        # The original guarantee: "Java" must not match "JavaScript". Kept.
        assert matcher("Java") is False

    def test_phrase_needs_all_its_content_words(self, matcher):
        # "Kubernetes" alone is present, but the phrase asks for more.
        assert matcher("Kubernetes") is True
        assert matcher("Kubernetes operators") is False


class TestEligibilityIsNotInvented:
    """
    The paid path calls score_job with no eligibility profile (guest checkout
    collects none) and no job country. knockout_reason() defaults an absent
    profile to remote_only=True — right for autoapply, where it stops someone
    applying to on-site roles they cannot take, wrong here. Every buyer was
    knocked to 0/20 and shown an "eligibility risk" that was an artifact.
    """

    JOB = {
        "title": "Senior Backend Engineer",
        "description": "Go, Python, PostgreSQL, Kafka, Kubernetes, settlement, reconciliation.",
    }

    def test_no_profile_means_no_penalty(self):
        out = jobfit.score_job(resume_text=RESUME, job=self.JOB)
        assert out["breakdown"]["eligibility"] == 20

    def test_no_profile_invents_no_risk_reason(self):
        out = jobfit.score_job(resume_text=RESUME, job=self.JOB)
        assert not any("eligibility risk" in r for r in out["reasons"])

    def test_a_strong_candidate_scores_strongly(self):
        # This resume against this posting is about as good as a match gets.
        # It scored 59 in production because of the phantom knockout.
        out = jobfit.score_job(resume_text=RESUME, job=self.JOB)
        assert out["score"] >= 75

    def test_a_real_profile_is_still_enforced(self):
        # The autoapply protection must survive: someone who said remote-only
        # should still be knocked out of an on-site role.
        out = jobfit.score_job(
            resume_text=RESUME,
            job=self.JOB,
            eligibility={"remote_only": True, "authorized_countries": ["Germany"]},
            job_country="United States",
        )
        assert out["breakdown"]["eligibility"] == 0
        assert any("eligibility risk" in r for r in out["reasons"])


def test_factor_maxima_match_the_ui():
    """
    The TypeScript surfaces (lib/lifecycle/weekly.ts, components/fit-report.tsx)
    normalise each factor by its maximum. Those constants said seniority 25 and
    eligibility 15 against the 20/20 actually awarded here, so a perfect
    seniority score rendered as 0.8 and read as a weakness.
    """
    out = jobfit.score_job(
        resume_text=RESUME,
        job={"title": "Senior Backend Engineer", "description": "Go Python Kafka Kubernetes"},
    )
    b = out["breakdown"]
    assert b["skills"] <= 50
    assert b["seniority"] <= 20
    assert b["eligibility"] <= 20
    assert b["language"] <= 10
    assert sum(b.values()) == out["score"]
