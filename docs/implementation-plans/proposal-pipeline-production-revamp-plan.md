# Proposal Pipeline Production Plan

**Branch:** `revamp/proposal_pipeline` (PR #1926)

**Status:** Final plan

**Date:** 2026-11-14

**Audience:** Engineering, Platform, SRE, Security, and Product

## Summary

The durable relay engine on this branch is kept and reshaped by eleven changes. Everything ships in one pull request, #1926: the changes land on this branch first, and the PR is merged only when the new flow is complete. It merges with `DURABLE_RELAY_SUBMISSIONS` off and is then enabled on staging and production.

PR #1932 (`fix/confidential_intent_stuck_watch`) is closed. Its three commits are brought onto this branch as step A and are part of changes 5 and 10.

No new tables, worker binaries, or services are introduced. The existing `relay_operations` and `relay_transactions` tables remain the system of record, and the existing engine remains the only code that drives an operation.

The shape after this plan:

- The request only stores the signed action (change 2).
- A worker loop in every backend process picks operations up and moves each one through named stages: `authorize`, `storage_top_up`, `registrations`, `relay`, `settle` (changes 3 and 11). Each stage is a small unit that does one thing. When its input is not ready it returns "not ready" and the next iteration tries again. Time spent in a stage is measured and alerted on.
- The confidential submit (MPC signature to 1Click) is a stage of its own on the intent row, with a single retrying path and no one-shot attempt (changes 5 and 10).
- No stage needs a manual resubmit. A stage that cannot finish keeps retrying and raises an alert by age.

A separate queue, table, or worker pool per stage is deferred. The section "Deferred work" lists what would justify it.

## What the pipeline guarantees after this plan

1. A request from a logged-in signer inserts one row and makes no RPC or chain read. It gets a confirmed result, a confirmed error, or `202` with a submission ID, and no dependency outage other than the database can fail it or lose it.
2. Sponsor-signed bytes and their hash are committed before the first broadcast. An unknown outcome is always reconciled by that hash; a replacement is signed only after the old transaction is proven unable to land.
3. Any backend process can drive any operation. Progress does not depend on the background-job leader.
4. No database transaction or lock is held during a network call.
5. An operation is never parked or failed because time or blocks passed while one of its transactions could still land. This includes the user's delegate action expiring while the relay transaction is in flight.
6. Credit, sponsor spend, and metrics are written exactly once, in the transaction that makes the operation terminal.
7. The client learns the outcome by polling the status endpoint. Server-sent events only make it faster.
8. A confidential intent approved through the relay is submitted to 1Click even when the Goldsky detector never sees the proposal. There is one submit path, and it retries until the intent is submitted, rejected, or past its deadline.
9. Every pending operation and every unsubmitted intent shows which stage it is in and since when. Any stage can be run again without touching the others.

## Design that stays as is

- **Content-derived idempotency.** The operation's `id` is derived from treasury, actor, and the signed bytes, so a retry lands on the same row. No client header and no separate key column are needed.
- **One response on the normal path.** After the insert the handler watches the row for up to 12 s and answers `200` or the confirmed error; anything slower returns `202`. The handler does no work on the operation.
- **One loop, one operation table.** Stages share the `relay_operations` queue, the lease, and the claim. They are not separate queues or worker pools.
- **Lease fencing, `SKIP LOCKED` claims, unique hash, unique `(public_key, nonce)`, one live transaction per step.** The lease is `lease_token` alone: while a worker holds an operation, `next_attempt_at` is when the lease runs out.
- **Dedicated sponsor lanes** through `SPONSOR_LANE_KEYS`.

## Changes

Each change lands as its own commit on this branch, in the order given under "Order of work". None requires a schema change except change 2, which edits the unmerged migration in place.

### 1. Lane claim without a transaction held across RPC

**Problem.** `claim_free_lane` opens a transaction and takes an advisory lock, and `sign_step` then reads the access key over RPC before committing. A slow provider pins a connection and a lane lock. The access-key and block-height reads have no timeout of their own.

**Change.**

- `RelayStore::free_lane_candidates(rotation)`: a plain read returning every lane with no `prepared` or `pending` transaction, in rotation order.
- `sign_step` walks the candidates. For each one it reads the access key, bounded by `STATUS_TIMEOUT`, then calls `claim_lane`.
- `RelayStore::claim_lane(public_key)`: a short transaction that takes the advisory lock, rechecks that the lane is free, and reads `MAX(nonce)`. The nonce is `max(chain nonce, floor) + 1`, the transaction is signed in memory, and `commit_prepared` commits.
- A candidate that was taken in between, or whose access-key read failed, is skipped and the next one is tried. `Step::Wait(LANE_WAIT)` is returned only when every candidate was taken; a transient error only when every read failed.
- A lane whose access key does not exist on chain is logged with `RELAY_SUBMISSION_INVARIANT_BROKEN` once per process and skipped, so a removed key cannot stall signing on the other lanes.
- `RelayRpc::access_key` and `RelayRpc::block_height` get explicit timeouts.
- Signers in one process take a signing turn first, from a first-come-first-served queue with one turn per lane (`SponsorLanes::turn`), and hold it until their transaction is final. Without it lanes go to whichever operation asks at the right moment: in a sandbox burst of 30 requests on two lanes, one waited 22 s while later ones were served. With it the slowest took 5 s.

The chain nonce may be a few hundred milliseconds old when the lock is taken. That is safe because every transaction this system signed on the lane is in `relay_transactions`, so the floor covers it.

**Files.** [`store.rs`](../../nt-be/src/handlers/relay/operations/store.rs), [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), [`rpc.rs`](../../nt-be/src/handlers/relay/operations/rpc.rs)

**Tests.** Two concurrent signers with two free lanes both sign without waiting. Two concurrent claims on the only free lane produce one prepared row and one wait. One lane with a failing access-key read: signing proceeds on the other lanes. An access-key read that hangs leaves no open transaction (pool connection count returns to baseline).

### 2. Intake only inserts; the engine does the rest

**Problem.** The handler authorizes against DAO policy, reads the deposit bond, reads the block height, reserves the credit, and then drives the operation itself on a spawned task. A request can fail on an RPC read before any row exists, and the request path is a second driver with its own budgets.

**Change.**

*Request.* `relay_delegate_action`, with the flag on, does four things:

1. Decodes the signed bytes with `parse_relay` and checks that the signer is the session user. Both are computation on the request body. The signer check moves out of `access::authorize` into `access::bind_signer`. Malformed bytes keep their `400` and a signer mismatch keeps its `403`.
2. Refuses with `429` when the session user already has more than 100 operations that are not yet authorized. This is a count in the insert transaction and bounds what one account can store.
3. Inserts the operation (or loads the existing one, which has the same derived `id`) in stage `authorize` with no credit reserved, then wakes the engine loop.
4. Watches the row with the existing `await_terminal` for up to `HANDLER_RESPONSE_BUDGET` and answers through the existing `respond`.

`drive_until_terminal`, the block-height check, the credit reservation in `intake::submit`, and `HANDLER_DRIVE_BUDGET` are removed.

*Engine.* The first stage is `authorize` (stage layout in change 11):

1. Age and delegate-expiry checks, as today.
2. `access::fetch_treasury_record`, `access::authorize` and `policy::enforce_deposit_limit`, called with an `AuthUser` built from the row's `actor_account_id`. These are the functions the handler calls today.
3. On a pass: one lease-fenced transaction runs `accounting::reserve_gas_credit`, sets `credit_reserved`, and advances the stage. The next stages follow in the same run.
4. On a refusal (`4xx`: not allowed, treasury not tracked, no credits, deposit over the limit): the operation ends as `failed` with the new `FailureCode::Rejected`, which stores the HTTP status. The relay error body is built from the status alone (`ApiError::rejected_before_send`), so the answer is the one the handler gives today. No credit was reserved, so nothing is refunded. Refusals are logged at info and raise no alert.
5. On a transport or `5xx` error from a policy, bond, or database read: the operation is deferred and retried, like any other transient step. The stage reads the policy itself before calling `access::authorize`, so a failed read is a quiet retry; going through the request's error path would raise `RELAY_SUBMIT_FAILED` on every attempt.

*Schema* (edited into `20261029000001_relay_operations.sql`): `credit_reserved` defaults to `FALSE`; an index on `(actor_account_id)` where `state = 'pending' AND stage = 'authorize'` for the count in step 2. The `stage` column itself is added by change 11.

The inline path (flag off) is unchanged.

**Consequences.** A refusal that today arrives in the response still does so when the engine reaches the row within 12 s, which is the normal case. When the engine is slower, the refusal arrives through the status endpoint, and the frontend shows it through the path it already has for a pending submission that fails. Rejected rows stay in the table; cleanup is in "Deferred work".

**Files.** [`submit.rs`](../../nt-be/src/handlers/relay/submit.rs), [`intake.rs`](../../nt-be/src/handlers/relay/operations/intake.rs), [`access.rs`](../../nt-be/src/handlers/relay/access.rs), [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), [`store.rs`](../../nt-be/src/handlers/relay/operations/store.rs), [`models.rs`](../../nt-be/src/handlers/relay/operations/models.rs), the migration

**Tests.**

- Every RPC provider down: the request returns `202` and the row exists; when providers return, the operation completes.
- Non-member, zero credits, deposit over the limit: the response carries the same status and body as the inline path, the row is `failed`, no credit moved, nothing was signed.
- Policy read fails on transport twice, then succeeds: the operation is authorized once and the credit reserved once.
- Two processes claim the same unauthorized row: one reservation.
- Process killed between the insert and authorization: another process authorizes and completes it.
- 101st unauthorized operation from one account: `429`, no row.
- Same signed bytes sent twice: one row, one reservation, both requests get the same answer.

### 3. Relay loop runs in every backend process

**Problem.** `relay-submissions` is an Apalis cron registered under the elected leader. Deferred and crashed operations wait on leadership, and a hard kill delays takeover to about two minutes because the dead worker's registration must go stale first.

**Change.**

- `RelayEngine::run_forever(shutdown)`: a plain loop calling `run_due`. It is spawned at startup in every process, outside `jobs::spawn_all`.
- Between cycles the loop waits on a `tokio::sync::Notify` held in `AppState`, with a 2 s timeout. Intake notifies after its insert commits, so a new operation is claimed at once by the process that received it. The 2 s timeout covers deferred work and rows inserted by another process.
- `run_due` starts each claimed operation on its own task under a concurrency limit of 64 and returns to claiming. It no longer waits for the whole batch, so one slow operation cannot hold back a new one.
- The claim takes operations that are past `authorize` before new ones, then the longest-due first. When more work is due than there are free slots, work already begun is finished before new work is started, so a burst of new requests cannot delay a relay that is waiting to be settled.
- `WORKER_BUDGET` rises from 10 s to 60 s. The loop is now the only driver, and a short budget would release an operation that is still making progress.
- The `relay-submissions` cron registration and its handler are removed.
- On shutdown the loop stops claiming and gives in-flight runs 10 s; whatever is left is picked up by another process when its lease expires.
- Stall detection moves from a process-local progress counter to the database, because an idle replica would otherwise report a stall while another replica does the work. `queue_health` gains `oldest_idle_seconds`: among pending operations with no `prepared` or `pending` transaction, the longest time since the later of the operation's `created_at` and its newest transaction's `updated_at`. `RELAY_QUEUE_STALLED` fires when it exceeds 120 s, and carries the stage of the oldest operation (change 11).

This measures time without real progress. It catches an operation that nobody claims and also one that is claimed and deferred on a transient error every cycle. Operations waiting on a broadcast transaction are covered by `RELAY_RECONCILIATION_STALLED`.

Replicas may each emit the same stall alert within one cooldown; Sentry groups them by code.

**Files.** [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), [`store.rs`](../../nt-be/src/handlers/relay/operations/store.rs), [`models.rs`](../../nt-be/src/handlers/relay/operations/models.rs), [`jobs/mod.rs`](../../nt-be/src/jobs/mod.rs), [`jobs/handlers.rs`](../../nt-be/src/jobs/handlers.rs), `main.rs`

**Tests.** Two processes on one database: each operation is driven once. SIGKILL the process holding an operation: the other finishes it within about 60 s (lease expiry). A follower process claims and completes work. An operation inserted while 32 others are waiting on slow reconciles is claimed within 100 ms. RPC down before any signing with one operation waiting: exactly one `RELAY_QUEUE_STALLED` after 120 s, from a setup where an idle second replica is also running.

### 4. Time alone never ends an operation that may still land

**Problem.** Two clocks can end an operation whose transaction may still land.

- After 30 minutes `expired_outcome` parks the operation in `manual_review` and refunds the credit, even with a transaction in flight. If that transaction later lands, the user sees "status unknown" for a relay that succeeded, and the relay was free. An operator reset re-parks the row because its age is unchanged.
- When the chain head passes the delegate action's `max_block_height`, `reconcile` fails the operation as `DELEGATE_EXPIRED` even if the pending transaction is the relay itself. That happens when status and resend come back unknown while the block-height read works. The relay may already be in a block from before the expiry. The user is told nothing was sent and to retry, the credit is refunded, and a retried add-proposal creates a duplicate.
- The age check sits behind a block-height read, so with the RPC down it is never reached.

**Change.**

- The age limit applies only when no transaction is `prepared` or `pending`. In that case nothing can land, so the outcome is `Failed` with `NOT_SENT` and funds state known, not manual review. The age check runs before any RPC read.
- Delegate expiry ends the operation as `DELEGATE_EXPIRED` only when the relay transaction is not in flight: before it is signed, or while an earlier step (storage top-up, registration) is the one pending.
- With the relay transaction in flight the operation stays `pending` and keeps reconciling with the existing backoff, whatever the head height. It ends only on proof: the transaction lands (success, or an on-chain failure such as an expired delegate), or it is superseded after an `Expired` refusal or after validity expiry with an absence quorum. `RELAY_RECONCILIATION_STALLED` already alerts at 10 minutes.
- After a relay transaction is superseded, an expired delegate ends the operation as `DELEGATE_EXPIRED`; otherwise the step is signed again.
- `manual_review` is left for invariant violations only.
- `RelayStore::resume_from_review(operation_id)`: sets the row back to `pending` and re-reserves the credit in one transaction. If the treasury has no credit left, the resume is refused and the row stays parked. Operators call it through `POST /internal/api/relay/submissions/{id}/resume` (change 11).

A relay with no expiry of its own (wallet replay) can therefore stay `pending` for up to the transaction validity window, about a day, during a long provider outage.

**Files.** [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), [`store.rs`](../../nt-be/src/handlers/relay/operations/store.rs)

**Tests.**

- Operation older than 30 minutes with a pending transaction that then lands: `succeeded`, credit consumed once, no manual-review alert.
- Same age with nothing in flight and the RPC down: `failed` / `NOT_SENT`, credit refunded once.
- Relay transaction broadcast, then sends and status dropped while block height keeps answering past the delegate expiry, then providers restored: the operation is still `pending` during the outage and ends with the transaction's real outcome.
- Storage top-up pending when the delegate expires: `failed` / `DELEGATE_EXPIRED`, and the top-up's spend is booked when it settles.
- Resume from review then success: credit consumed once. Resume with zero credits: refused.

### 5. Confidential submit is one retrying stage

**Problem.** Handing an approved intent to 1Click has two paths. The relay tries once, right after the vote lands, inside `settle_landed`. If the MPC callback is not in the outcome yet, 1Click errors, or the process dies, that attempt is gone. A second path, `resubmit_awaiting_intents`, retries, but:

- it only handles `shield` intents (`POLL_SUBMITTED_INTENT_TYPES`); an `auth` or `bulk_auth` intent that misses the one attempt has no retry at all;
- it runs inside the per-DAO 1Click history poll, under the job leader, and is skipped when that DAO's history fetch fails;
- nothing alerts on how long an approved intent has been waiting; the first signal is `CONF_INTENT_EXPIRED_UNSUBMITTED` at the intent's deadline.

The one-shot attempt also holds the operation's lease while 1Click answers, which delays the user's result.

**Brought in from the closed PR #1932** (step A):

- The retry covers `bulk_auth`. A login is posted again without the 1Click history lookup, and one past its deadline is retired. `auth` rows are no longer created, so `auth` needs nothing.
- `CONF_INTENT_SUBMIT_STALLED` exists, at 10 minutes, with `CONF_INTENT_EXECUTION_UNSTAMPED` and `BULK_CONF_STALLED`, raised by the `confidential-intent-watch` cron.
- The bulk processor arms a bulk row itself once its header is submitted.

**Change (what remains).** The retrying path becomes the only path, and it runs in the worker loop.

- `auto_submit_confidential` is removed from the engine. When the vote relay lands, the terminal commit marks each approved intent `due` (change 10) and the loop is woken.
- `ConfidentialIntentSubmitter::run_queue_forever` runs in every process. Each pass lists the DAOs that have an intent waiting, the one whose intent has waited longest first, and starts `resubmit_awaiting_intents` for each on its own task, at most eight DAOs at once per process. A DAO already being worked is left out of the next pass. One DAO with slow 1Click calls therefore holds one slot and delays no other DAO. The queue is woken when a relay marks an intent due and otherwise looks every 2 s. The per-DAO history poll keeps its call. The existing submit lease on the intent row keeps two callers from posting the same intent.
- No new index is needed: `idx_confidential_intents_submit_due` already covers rows in `due`, `unknown`, and `in_flight`.
- For each due intent the stage reads the MPC signature from the execution transaction. Not there yet: the intent is left `due` and retried on the next cycle, with a 2 s delay for the first minute and the existing backoff after that. There: it is posted to 1Click with the existing lease, outcome states, and history reconciliation.
- `CONF_INTENT_SUBMIT_STALLED` moves from 10 minutes to 5, because the stage now retries every cycle and no longer waits for the DAO's turn in the history poll. The watch cron stays where it is; its three codes are added to the drill (change 8).
- The inline relay path keeps `spawn_auto_submit_intents` until the inline path is removed in step H. It reads the landed transaction by the outcome's own id. Before this change it used the hash of the transaction near-api rebuilds from the RPC view, which lacks the block hash and never matches the chain, so the signature lookup failed and the stamp was left to the Goldsky detector.

**Prerequisite.** Change 10. Without the relay's own stamp, the stage cannot find an intent the Goldsky detector missed.

**Files.** [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), [`confidential.rs`](../../nt-be/src/handlers/relay/confidential.rs), [`error_event.rs`](../../nt-be/src/error_event.rs), [`sentry_drill.rs`](../../nt-be/examples/sentry_drill.rs)

**Tests.**

- Approve vote lands, MPC callback arrives 60 s later: the operation is `succeeded` at once, the intent stays `due`, and it is submitted within 2 s of the callback.
- 1Click down for 3 minutes: the intent is submitted after it returns, with no operator action.
- 1Click history endpoint failing for the DAO: the intent is still submitted.
- Process killed right after the terminal commit: another process submits the intent, single and bulk.
- `bulk_auth` intent with a late MPC callback and no one-shot attempt: credentials are stored once the callback is on chain.
- Two processes work the same due intent: one post to 1Click.
- Intent still unsubmitted 5 minutes after execution: exactly one `CONF_INTENT_SUBMIT_STALLED`.

### 6. Registration targets fail closed

**Problem.** `derive_targets_for_proposal` returns an empty set when the proposal or bulk-list fetch fails. The engine reads that as "nothing to register" and signs the approving vote.

**Change.**

- The function returns `Result` with two error kinds. A transport or provider error is transient: the engine defers the operation and retries. A contract answer that the proposal or bulk list does not exist is permanent: the engine treats it as no targets and continues, so the chain rejects the vote with its own reason within seconds, as it does today.
- The storage-contract allowlist gets the same treatment, per source. It is built from two upstream lists (bridge tokens and the Ref whitelist). A token found in what has loaded is registered. A token not found is skipped only once both lists have loaded at least once; until then the answer is a transient error, because the list that is missing could still name it. A failed refresh keeps that source's last list, and a list that has never loaded is asked for again every 30 s instead of every hour.
- With no transaction in flight, the stage checks age and delegate expiry before its lookups, so an operation whose lookups keep failing ends as `NOT_SENT` after 30 minutes instead of retrying for ever.
- The inline path keeps its current behaviour by mapping every error to an empty set at its call site.

**Files.** [`registrations.rs`](../../nt-be/src/handlers/relay/effects/registrations.rs), [`allowlist.rs`](../../nt-be/src/handlers/relay/effects/allowlist.rs), [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs)

**Tests.** Proposal fetch fails once on transport, then succeeds: no relay transaction is signed before the registration step, and the operation completes. Vote on a proposal ID that does not exist: the operation fails on chain in normal time, not after a retry loop. Allowlist provider down on a cold start: the approve vote waits, then registers once the provider answers.

### 7. Frontend polls while waiting

**Problem.** After a `202` the page relies on the SSE event, with a 60-second safety read. An event emitted by another replica, or missed, delays the result by up to a minute.

**Change.**

- While any submission is awaited, `relay-submissions.ts` re-reads the pending set on a `1 s → 2 s → 5 s` backoff (then every 5 s) instead of every 60 s. The SSE event still settles immediately when it arrives. Reconnect, visibility, and mount recovery stay.
- A `401` or `403` from the status endpoint stops polling for that treasury until the session changes; the IDs stay remembered. Only `404` abandons a submission.
- `MAX_REMEMBERED` rises from 20 to 200 so a large bulk approve survives a page refresh.

**Files.** [`relay-submissions.ts`](../../nt-fe/lib/relay-submissions.ts), [`relay-submissions.test.ts`](../../nt-fe/lib/relay-submissions.test.ts)

**Tests.** No SSE event delivered: the waiter settles on the first poll after the operation turns terminal. Timer stops when nothing is awaited. Status endpoint answers `401`: polling stops and the ID is still remembered.

### 8. Alert drill covers the relay codes

**Change.** Add the six relay error codes to `sentry_drill.rs` and verify Sentry-to-Discord routing for the P0/P1 codes.

**Files.** [`sentry_drill.rs`](../../nt-be/examples/sentry_drill.rs)

### 9. Inline path honours an existing durable operation

**Problem.** With the flag turned off, a retry of signed bytes that already have a `relay_operations` row goes down the inline path. The user's nonce prevents a second proposal, but the storage top-up and the credit are charged a second time.

**Change.** Before reserving a credit, the inline path looks up the idempotency key. If an operation exists, the request is answered from that operation exactly as the durable path would answer it (watch, then `respond`), and the inline path does nothing else. This includes a row that is not yet authorized: the engine loop runs regardless of the flag and finishes it.

**Files.** [`submit.rs`](../../nt-be/src/handlers/relay/submit.rs), [`intake.rs`](../../nt-be/src/handlers/relay/operations/intake.rs)

**Tests.** Submit with the flag on and get `202`; restart with the flag off and repeat the same body: same submission ID, no second top-up, credit decremented once.

### 10. The relay records the execution itself

**Problem.** A confidential intent is submitted to 1Click by one of two paths. The relay's own auto-submit runs once, right after the vote lands. The per-DAO poll retries, but it only picks up intents that have `proposal_execution_transaction_hash` set, and only the Goldsky detector sets it. When the detector misses the proposal (a late sink row, a Goldsky outage) and the one auto-submit attempt did not complete (MPC callback not in the outcome yet, 1Click error, process crash), nothing ever submits the intent. The same gap leaves a bulk-payment header unarmed.

The relay already holds every fact the detector would stamp: the vote carries the payload hash and the proposal ID, and the landed outcome carries the transaction hash, the block, and the `v1.signer` sign log that proves the approval executed.

**Brought in from the closed PR #1932** (step A). `try_auto_submit_intent` records the execution hash and marks the intent `due` whenever the vote outcome carries the sign call, including when the MPC callback is not there yet (`record_confidential_intent_execution`, safe to run in either order with the detector). That fixes the reported bug.

What it leaves open: the stamp is a best-effort write inside the one-shot call. If that write fails it is only logged, the intent waits for the Goldsky detector, and `CONF_INTENT_EXECUTION_UNSTAMPED` asks an operator to stamp it by hand. Change 5 removes the one-shot call, so the stamp needs a home that cannot be skipped.

**Change (what remains).**

- When the relay step of a vote operation lands, the engine lists the voted payloads whose sign call appears in the outcome, using the existing `extract_sign_call_from_logs`.
- In the transaction that makes the operation `succeeded`, for each of those payloads it writes to `confidential_intents`: `proposal_id` (when not already set), `proposal_executed_at`, execution block height, `proposal_execution_transaction_hash`, and `submit_state = 'due'` when the intent has not been submitted. This is `record_confidential_intent_execution` from step A, given an executor argument so it runs on the completion connection. If the commit fails, the operation is not terminal and `settle` runs again, so the stamp cannot be lost.
- Bulk-payment rows need nothing here: the bulk processor arms them from the submitted header (step A).
- All writes keep existing values (`COALESCE`), so the detector and the relay can stamp in either order.
- When the relay lands an `add_proposal` for a confidential payload, the same commit writes the new proposal id onto the intent. The stuck-intent watch needs that id to follow a proposal that is later voted on from a wallet.
- The watch keeps raising `CONF_INTENT_SUBMIT_STALLED` past the deadline for a row still in `unknown`, which the queue cannot retire on its own.

After this, the submit stage (change 5) finds every intent approved through the relay, whether or not Goldsky saw the proposal.

**Not covered.** A vote that does not go through the relay (signed and sent directly from a wallet) is still stamped only by the detector. A vote whose request omits the proposal `kind` carries no payload hash and is also left to the detector.

**Files.** [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), [`store.rs`](../../nt-be/src/handlers/relay/operations/store.rs), [`proposal_signals.rs`](../../nt-be/src/handlers/intents/confidential/proposal_signals.rs)

**Tests.**

- Detector disabled, MPC callback absent from the relay outcome: the intent is stamped and `due` at commit, and the submit stage posts it once the callback is on chain.
- Detector disabled, 1Click down: the submit stage posts after 1Click returns.
- Detector disabled, bulk-payment header approved: the header is submitted by the stage, the processor arms the bulk row, and the recipients are processed.
- The stamp's `UPDATE` fails once: the operation stays in `settle`, and the retry commits the result and the stamp together.
- Vote that does not reach the approval threshold: nothing is stamped.
- Detector stamps first, then the relay: values unchanged, one submission.

### 11. Explicit stages

**Problem.** `RelayEngine::step` is one function in a 1,300-line file. It works out what to do next by inspecting the transaction rows: broadcast a prepared one, reconcile a pending one, otherwise sign the next missing step. The behaviour is already "do one thing, record it, come back later", but the stage is not stored anywhere. Nobody can read from a row where an operation is, an alert cannot say which stage is slow, and changing or re-running one stage means understanding all of them.

**Change.**

*Data* (edited into the unmerged migration).

- `relay_operations.stage`, an enum `relay_operation_stage`: `authorize`, `storage_top_up`, `registrations`, `relay`, `settle`. Default `authorize`.
- `relay_operations.stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `RelayStore::advance_stage(lease, from, to)`: a lease-fenced update that matches only when the row is still in `from`. It sets `stage_entered_at`.

The stage column says what the operation is doing. `relay_transactions` stays the record of what was signed and sent. A stage never advances while it has a `prepared` or `pending` transaction of its own.

*Code.* `engine.rs` is split into a folder with one file per stage. No behaviour moves between processes or tables.

```
nt-be/src/handlers/relay/operations/
├── intake.rs            request: save the row, watch it, respond      (existing, change 2)
├── status.rs            status endpoint                               (existing)
├── models.rs            row types, stage enum, failure codes          (existing)
├── store.rs             every SQL statement                           (existing)
├── rpc.rs               chain reads and sends                         (existing)
├── lanes.rs             sponsor keys                                  (existing)
├── engine.rs            the loop: claim, renew lease, call the stage, defer
├── health.rs            stall checks, per-stage counts, orphan sweep
└── stages/
    ├── mod.rs           the `Stage` trait, `StageResult`, stage order
    ├── authorize.rs
    ├── storage_top_up.rs
    ├── registrations.rs
    ├── relay.rs
    ├── settle.rs
    └── transaction.rs   sign on a lane, broadcast, reconcile, supersede
```

| Stage | Does | Advances when | "Not ready" when |
|---|---|---|---|
| `authorize` | Policy, deposit limit, credit reservation (change 2) | Authorized and credit reserved | A policy, bond, or database read fails on transport |
| `storage_top_up` | Sponsor transfer for proposal storage | Its transaction succeeded, or no storage is owed | Its transaction is not final, or no lane is free |
| `registrations` | Token `storage_deposit` batches for approving votes | Every batch succeeded, or none is needed | Target lookup fails on transport (change 6), a batch is not final |
| `relay` | Sends the user's action | Its transaction is final on chain, success or failure | The transaction is not final |
| `settle` | Reads the landed outcome by hash and writes the result in one commit: state, proposal ids, credit, spend, metrics, execution stamp (change 10) | Ends the operation | The outcome cannot be read yet |

`transaction.rs` is not a stage. It is the sign, broadcast, reconcile, and supersede logic (changes 1 and 4) that the three chain stages share.

*Why `settle` is its own stage.* Between the relay landing on chain and the result being committed, the operation is in a state the code already handles as a special branch ("the relay landed but the completion did not commit"). Naming it means a crash there resumes with a read by hash and never goes near signing again, and a row stuck there says so.

*What is not a stage.*

- Signed, sent, and confirmed. These are the `prepared`, `pending`, and `succeeded` states of the stage's row in `relay_transactions`. Stage plus transaction state gives the full position: `relay` + `prepared` is signed and not sent; `relay` + `pending` is sent and awaiting the chain.
- Waiting for a free lane, a provider, or a lookup. These are "not ready" results. The reason is written to the existing `last_error` column on each deferral, so the row says what it is waiting for.
- Sending the intent to 1Click. One vote can approve several intents, and the operation is finished for the user once the vote lands. That stage lives on each intent row as `submit_state` (change 5).
- Succeeded, failed, and manual review. These stay in `state`. `stage` keeps its last value, so a failed or parked row shows where it stopped.

Each stage is a struct with one entry point returning `Advance`, `NotReady(delay, reason)`, or `Done(outcome)`. On `NotReady` the engine defers the operation with the existing backoff and releases it; the next cycle claims it and calls the same stage again. A stage holds no state between calls; everything it needs is in the two tables.

*Alerting.* `queue_health` reports, per stage, the count of pending operations and the oldest `stage_entered_at`. The stall alert of change 3 names the stage and its age. The worker's cycle log line prints the per-stage counts.

*Re-triggering.* Every stage retries on its own, so nothing needs a manual resubmit in normal operation. For an operator:

- `RelayStore::retrigger(operation_id)` makes a pending operation due now; the loop runs its current stage on the next cycle.
- `RelayStore::resume_from_review(operation_id)` (change 4) puts a parked operation back into the stage it was parked in.
- Operators reach both through endpoints behind the existing admin login (`ADMIN_USERS`, the same one the status manager uses), in [`operations/admin.rs`](../../nt-be/src/handlers/relay/operations/admin.rs):
  - `GET /internal/api/relay/submissions` lists every operation that is not finished (pending or parked), oldest first, with its stage, how long it has been there, its last error and its transactions.
  - `GET /internal/api/relay/submissions/{id}` shows one.
  - `POST /internal/api/relay/submissions/{id}/retrigger` runs a pending operation's current stage now. `409` when it is parked or finished.
  - `POST /internal/api/relay/submissions/{id}/resume` puts a parked operation back to work. `409` when it is not parked, or the treasury has no credit left to take.
  Each action is logged with the admin's name. No SQL is needed to see or move an operation.

**Files.** [`engine.rs`](../../nt-be/src/handlers/relay/operations/engine.rs), new `operations/stages/` and `operations/health.rs`, [`store.rs`](../../nt-be/src/handlers/relay/operations/store.rs), [`models.rs`](../../nt-be/src/handlers/relay/operations/models.rs), the migration

**Tests.** In `stages/tests.rs`, against a test database and a scripted chain node; a crash is a claim dropped with its lease expired.

- Each stage in isolation against a test database: ready input advances, missing input returns `NotReady` and writes nothing, a second call after a crash mid-stage does not sign a second transaction.
- An operation killed in each stage is finished by another process from that stage, not from the start.
- Process killed after the relay lands and before the result commits: the row is in `settle`, another process commits the result once, and no transaction is signed.
- Two processes cannot both advance one operation (`advance_stage` matches once).
- `retrigger` on an operation deferred for 60 s: its stage runs within one cycle.
- Registration lookups failing for 3 minutes: the alert names `registrations`.
- The existing engine tests pass unchanged against the split code.

## Order of work

| Step | Content | Gate |
|---|---|---|
| A | Bring the three commits of `fix/confidential_intent_stuck_watch` onto this branch (they are already stacked on it, so this is a fast-forward); close PR #1932 | Its tests green on this branch |
| B | Changes 11, 2 and 3, in that order (they share the loop and the migration; `authorize` is the first stage) | Existing engine tests pass unchanged; tests listed under each change |
| C | Changes 1, 4, 6, 7, 8, 9, 10 | Tests listed under each change |
| D | Change 5 | Change 10 done and its detector-disabled tests green |
| E | Merge PR #1926 with the flag off | CI green; merge checklist sections A and B; sandbox rerun of sections C–H on the final build |
| F | Staging: flag on with dedicated lane keys | One week with no manual-review, invariant, or stall alert; credit and spend totals reconcile |
| G | Production: flag on with eight dedicated lane keys | Same as F, for two weeks |
| H | Remove the inline relay path and the flag | No pending durable operations older than one day |

Steps A to D are commits on this branch. Nothing is merged to `main` before step E.

The flag and the inline path stay until step H. They are the rollback: with the flag off, production runs exactly what it runs today.


## Rollout and rollback

- Lane keys are full-access keys on the sponsor account that no other code path uses. Staging uses two; production starts with eight and is resized from measured peak concurrency. One lane handled about 32 relays per minute in the sandbox.
- Turning the flag off sends new requests down the inline path. The relay loop runs regardless of the flag, so operations already accepted keep draining, and change 9 keeps a retried request attached to its existing operation.
- An operation that has a prepared or broadcast transaction is never replayed through the inline path.
- A lane key is retired by removing it from `SPONSOR_LANE_KEYS` only after it has no `prepared` or `pending` transaction.

## Acceptance criteria

- The durable request handler makes no RPC or chain call. With every provider down, a valid request returns `202` and its row exists.
- A refused request (not allowed, no credits, deposit over the limit) gets the same status and body as today, reserves no credit, and signs nothing.
- With the access-key provider down, no pool connection stays checked out for the length of the outage.
- Killing any one backend process loses no operation and duplicates no on-chain transaction; another process finishes the work within about 60 s.
- A follower process drives relay operations.
- No operation reaches `manual_review`, `failed`, or loses its credit hold while one of its transactions can still land. In particular, no operation is reported `DELEGATE_EXPIRED` while its relay transaction is unresolved.
- An operation that makes no progress for 120 s raises one alert, whether it is unclaimed or deferred every cycle.
- One unusable lane does not stop signing on the others.
- A vote on a nonexistent proposal fails in normal time.
- A request retried with the flag off does not charge the sponsor or the credit a second time.
- With the Goldsky detector disabled, every confidential intent and bulk-payment header approved through the relay is submitted and processed.
- The durable path has no one-shot submit to 1Click. An intent whose first attempt fails for any reason is submitted later with no operator action, and one that waits 5 minutes raises an alert.
- A pending operation's stage and time in stage can be read from its row. An operation interrupted in any stage resumes from that stage.
- No failure mode in the durable path requires a manual resubmit. Operator action is needed only for `manual_review`, which is reached only on an invariant violation.
- One request produces one operation, one authorization, one credit reservation, and at most one live transaction per step.
- A new operation is claimed within 100 ms of its insert on the process that received it.
- A missed SSE event delays the client by at most 5 s.
- A failed target lookup never results in an approving vote being relayed without its registrations.
- All six relay alert codes and the three confidential watch codes reach their channels in the drill.
- Merge checklist sections B through I pass on the final build.

## Deferred work

These are not built now. Each has a trigger.

| Item | Build it when |
|---|---|
| Dedicated relay worker service (same engine, no HTTP) | Web deploys or web load measurably delay relay completion |
| Signer keys isolated to that worker | The dedicated worker exists and lane keys are the only sponsor keys the relay uses |
| Durable event log with SSE replay | Polling at 5 s is shown to be too slow or too costly |
| Outbox for downstream effects | A downstream effect appears that has no reconciling poll of its own |
| Separate queue or worker pool per stage | One stage needs its own concurrency limit or its latency starves the others |
| Deleting rejected operations | `relay_operations` rows that failed before authorization exceed a size worth reclaiming |

## Out of scope

- A guard against a user signing the same proposal again while the first is still pending. A re-signed action is a new payload, so both can land as two proposals. Votes are not affected. This is left out because the inline path behaves the same way today, it takes a second deliberate signature from the user, and the result is a duplicate proposal that still needs its own approvals before any money moves.
- A message broker.
- Exactly-once execution across the chain RPC boundary; the guarantee is reconciliation by persisted hash.
- Changes to parsing, RPC outcome classification, or transaction signing beyond what the eleven changes require.
