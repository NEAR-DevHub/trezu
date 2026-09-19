# Early Access — Attio runbook

`POST /api/early-access` is the landing page's "Request Early Access" form. It
is public and unauthenticated; the browser posts here rather than to Attio so
the API key stays server-side. Each accepted submission upserts a person on
`matching_attribute=email_addresses` and then adds them to the early-access
list, checking the list first so a retry cannot create the row twice.

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `ATTIO_API_KEY` | yes | Bearer token. No public prefix, so it never reaches the browser. Request your own rather than reusing someone else's. |
| `ATTIO_EARLY_ACCESS_LIST_ID` | yes | The list new leads are added to. |
| `ATTIO_API_BASE_URL` | no | Override for tests. Defaults to the live API. |

The Attio People object also needs the attributes the form writes:
`company_name`, `telegram`, `business_type`, `referral_source`, `marketing_opt_in`,
`lead_source`, `submitted_at`, and the seven attribution slugs. Attio rejects a
value a select attribute does not already offer, so the option lists in
`nt-fe/features/landing/content.ts` must match the ones configured there
verbatim.

## Failure modes

**`ATTIO_NOT_CONFIGURED` (P1).** Either variable is unset, so the endpoint can
record nothing. Every submission is answered `500` and the lead is lost — the
form deliberately does not pretend to succeed. The alert is emitted once per
process, so a quiet page does not mean the problem has gone away. Recovery: set
both variables, restart, and submit the form once; a healthy deployment answers
`204 No Content` and the person appears on the list.

**`ATTIO_LEAD_SYNC_FAILED` (P2).** Attio was reachable but refused or failed the
call, answered `502`. A `value_not_found` in the message names an attribute
slug the workspace is missing — add it in Attio rather than changing the
backend. Transport failures, 429s and 5xx are retried three times before this
fires.

**`504 Gateway Timeout`.** The route caps a submission at 10 seconds, which is
past the ~7s of retry backoff a capture can spend. A sustained Attio outage will
hit it. The work is idempotent, so the visitor can safely resubmit.
