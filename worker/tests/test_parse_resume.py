"""
Resume import parsing (P4.1).

normalise() is the whole risk surface: the LLM is on the other side of a network
call, and every field it returns is untrusted. The tests below are the shapes a
model actually emits when it misbehaves — nulls, numbers where strings belong,
a hundred jobs, invented empty rows — plus the two product rules that must hold:
nothing is invented, and an unusable parse says so instead of pretending.
"""
import pytest

from worker.ai.parse import (
    MAX_BULLETS,
    MAX_SKILLS,
    MAX_WORK,
    normalise,
    parse_resume_text,
)

GOOD = {
    "fullName": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "+44 20 7946 0000",
    "linkedin": "linkedin.com/in/ada",
    "targetRole": "Staff Engineer",
    "yearsExp": 9,
    "location": "London, UK",
    "workHistory": [
        {
            "company": "Analytical Engines Ltd",
            "role": "Staff Engineer",
            "startDate": "Jan 2021",
            "endDate": "Present",
            "bullets": ["• Led the compiler team", "- Cut build times 40%"],
        }
    ],
    "education": [{"school": "Cambridge", "degree": "BA Mathematics", "year": "2014"}],
    "skills": ["Python", "Rust", "python"],
}


def test_happy_path_keeps_every_field():
    out = normalise(GOOD)
    assert out is not None
    assert out["fullName"] == "Ada Lovelace"
    assert out["yearsExp"] == 9
    assert out["workHistory"][0]["endDate"] == "Present"
    assert out["education"][0]["school"] == "Cambridge"


def test_strips_bullet_characters_but_not_the_text():
    out = normalise(GOOD)
    assert out["workHistory"][0]["bullets"] == [
        "Led the compiler team",
        "Cut build times 40%",
    ]


def test_deduplicates_skills_case_insensitively():
    # "Python" and "python" are one skill; a resume listing both is a resume
    # that should not show the user two identical inputs.
    assert normalise(GOOD)["skills"] == ["Python", "Rust"]


@pytest.mark.parametrize("bad", [None, "a string", [], 42])
def test_rejects_non_dict_responses(bad):
    assert normalise(bad) is None


def test_returns_none_when_nothing_identifying_was_found():
    # No name, no role, no jobs — prefilling three blank inputs and calling it
    # an import is worse than showing the empty form.
    assert normalise({"skills": ["Python"], "location": "Berlin"}) is None


def test_survives_nulls_in_every_field():
    out = normalise({k: None for k in GOOD} | {"fullName": "Ada"})
    assert out is not None
    assert out["email"] == ""
    assert out["yearsExp"] == 0
    assert out["workHistory"] == []
    assert out["skills"] == []


def test_coerces_a_numeric_phone_rather_than_dropping_it():
    out = normalise(GOOD | {"phone": 5551234})
    assert out["phone"] == "5551234"


@pytest.mark.parametrize("years,expected", [("7", 7), (7.9, 7), (-3, 0), (900, 0), ("many", 0)])
def test_years_of_experience_is_clamped_to_something_believable(years, expected):
    assert normalise(GOOD | {"yearsExp": years})["yearsExp"] == expected


def test_drops_work_entries_with_neither_company_nor_role():
    out = normalise(
        GOOD
        | {
            "workHistory": [
                {"company": "", "role": "", "bullets": ["x"]},
                {"company": "Real Co", "role": "", "bullets": []},
            ]
        }
    )
    assert len(out["workHistory"]) == 1
    assert out["workHistory"][0]["company"] == "Real Co"


def test_a_job_with_no_bullets_still_gets_one_empty_input():
    # The form renders one input per bullet; an empty list leaves the user with
    # nothing to type into.
    out = normalise(GOOD | {"workHistory": [{"company": "X", "role": "Y", "bullets": []}]})
    assert out["workHistory"][0]["bullets"] == [""]


def test_caps_a_runaway_response():
    out = normalise(
        GOOD
        | {
            "workHistory": [
                {"company": f"C{i}", "role": "R", "bullets": [f"b{j}" for j in range(50)]}
                for i in range(100)
            ],
            "skills": [f"skill-{i}" for i in range(500)],
        }
    )
    assert len(out["workHistory"]) == MAX_WORK
    assert len(out["workHistory"][0]["bullets"]) == MAX_BULLETS
    assert len(out["skills"]) == MAX_SKILLS


def test_ignores_extra_keys_the_model_made_up():
    out = normalise(GOOD | {"summary": "A great candidate", "salary": "$200k"})
    assert "summary" not in out
    assert "salary" not in out


@pytest.mark.asyncio
async def test_short_input_never_reaches_the_model():
    # No API key is configured in tests; if this called out it would raise.
    assert await parse_resume_text("Ada Lovelace") is None
    assert await parse_resume_text("") is None
