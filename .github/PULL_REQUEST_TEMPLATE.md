<!-- DO NOT DELETE THIS TEMPLATE — CI will reject the PR otherwise. -->

## Prompt
<!-- e.g. "Prompt 19 — Per-application AI tailoring". Use "ad-hoc" if no prompt. -->

## Blocks touched
<!-- Comma-separated, must match keys in docs/blocks.yaml.
     Example: resume-domain, ai, sender -->

## Blocks NOT touched (forbidden by scope)
<!-- Comma-separated. Confirms you stayed in lane.
     Example: auth, billing, scraping, extension, notifications -->

## Block-isolation check
- [ ] Ran `git diff --name-only origin/main...HEAD` — every file maps
      to a path in `docs/blocks.yaml` under a declared block or
      `shared`. CI will re-verify.

## Tests
<!-- Unit: X passing. E2E: Y passing. -->

## PMF impact
<!-- Which metric in docs/PMF_FRAMEWORK.md is this supposed to move,
     and how will you verify post-merge?
     Example: "Interview rate per paying user (PMF § 1 Test 1).
     Verify by tracking week-over-week change in /admin/pmf dashboard." -->
