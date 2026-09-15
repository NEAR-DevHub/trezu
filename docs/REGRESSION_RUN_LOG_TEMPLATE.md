# Regression Run Log

Copy this file (don't edit the template in place) into the release notes / PR
description for the run it covers. One log per run — smoke, release
regression, or full regression. See [MANUAL_REGRESSION_CHECKLIST.md](MANUAL_REGRESSION_CHECKLIST.md)
for what each check ID means.

**Run type:** S / R / F (delete two)
**Date:** YYYY-MM-DD
**Tester:** 
**Environment:** staging / prod
**Release / PR:** link
**Checklist version tested against:** (see the Version line at the top of MANUAL_REGRESSION_CHECKLIST.md)

## Results

Only list checks in scope for this run's tier (see the tier table in
"How to use this checklist"). Leave `Notes` empty for a clean pass.

| Check ID | Result | Bug link (if fail) | Severity | Notes |
|----------|--------|---------------------|----------|-------|
| AUTH-01  |        |                     |          |       |
| PAY-01   |        |                     |          |       |

Result values: `pass` / `fail` / `blocked` (+ reason) / `skipped` (+ reason).

## Summary

- P0 checks: all pass? (mandatory before release — see the Coverage
  traceability table at the bottom of the checklist)
- New bugs filed this run: 
- Known issues re-hit from a previous run: 
- Sign-off: 
