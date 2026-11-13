//! Watch for confidential intents stuck after approval.
//!
//! An approved proposal whose signed intent never reaches 1Click shows the
//! user a swap that hangs while nothing fails anywhere: the relay submits
//! only when the vote outcome carries the MPC signature, the per-DAO poll
//! submits only rows whose execution facts are stamped, and the Goldsky
//! detector that stamps them skips sink rows landing out of block order
//! (honolulu #9, 2026-11-12). This sweep pages on the invariant itself: a
//! `pending` intent whose proposal is approved on chain must be handed to
//! 1Click within the grace period.
//!
//! - `CONF_INTENT_EXECUTION_UNSTAMPED`: chain says approved but the row has
//!   no execution transaction hash, so nothing will ever submit it.
//! - `CONF_INTENT_SUBMIT_STALLED`: execution stamped, still unsubmitted past
//!   the grace period, so the poll is not getting to it.
//!
//! The `confidential-intent-watch` cron runs the sweep every two minutes.
//! Chain reads are budgeted per sweep and rotate least-recently-read first,
//! so a pile of unstamped rows costs a bounded number of RPC calls per tick.
//! Each stuck intent alerts once per repeat interval until the row moves.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use near_api::AccountId;
use serde_json::Value;

use crate::AppState;
use crate::error_event;
use crate::error_event::ErrorCode;
use crate::handlers::proposals::scraper::{ProposalStatus, fetch_proposal};
use crate::handlers::relay::confidential::{POLL_SUBMITTED_INTENT_TYPES, intent_deadline};

/// How long an approved intent may stay unstamped before paging: covers the
/// relay's own stamp landing and the detector's normal lag.
const UNSTAMPED_GRACE: Duration = Duration::from_secs(300);
/// How long a stamped intent may stay unsubmitted: the poll visits each DAO
/// every ~2 min and backs failed attempts off to at most 5 min.
const STALLED_GRACE: Duration = Duration::from_secs(600);
const ALERT_REPEAT: Duration = Duration::from_secs(3600);
/// Upper bound on `get_proposal` reads in one sweep; rows beyond it wait
/// their turn.
const CHAIN_READS_PER_SWEEP: usize = 20;

#[derive(sqlx::FromRow)]
struct CandidateRow {
    dao_id: String,
    payload_hash: String,
    intent_payload: Value,
    proposal_id: i64,
    proposal_executed_at: Option<DateTime<Utc>>,
    proposal_execution_transaction_hash: Option<String>,
    submit_state: String,
    submit_attempts: i32,
    submit_last_error: Option<String>,
    submit_next_attempt_at: Option<DateTime<Utc>>,
}

impl CandidateRow {
    fn key(&self) -> String {
        format!("{}/{}", self.dao_id, self.payload_hash)
    }

    fn deadline(&self) -> Option<DateTime<Utc>> {
        intent_deadline(&self.intent_payload)
    }

    fn deadline_passed(&self, now: DateTime<Utc>) -> bool {
        self.deadline().is_some_and(|deadline| deadline < now)
    }
}

/// What the chain says about a candidate's proposal.
enum ChainVerdict {
    Approved,
    Open,
    /// Rejected, removed, expired, moved or failed: never going to be signed.
    Finished,
    Unknown,
}

impl From<&ProposalStatus> for ChainVerdict {
    fn from(status: &ProposalStatus) -> Self {
        match status {
            ProposalStatus::Approved => ChainVerdict::Approved,
            ProposalStatus::InProgress => ChainVerdict::Open,
            ProposalStatus::Rejected
            | ProposalStatus::Removed
            | ProposalStatus::Expired
            | ProposalStatus::Moved
            | ProposalStatus::Failed => ChainVerdict::Finished,
        }
    }
}

/// Per-intent bookkeeping carried between sweeps. In memory on purpose: a
/// restart re-reads every candidate from chain once and re-alerts each stuck
/// one once, which is the behaviour wanted after a deploy anyway.
#[derive(Default)]
pub struct WatchMemory {
    /// Proposals chain reported finished without approval; not asked again.
    finished: HashSet<String>,
    /// When an approved intent was first seen without its execution stamp.
    first_seen_unstamped: HashMap<String, Instant>,
    /// When chain was last asked about a row; drives the read rotation.
    last_chain_read: HashMap<String, Instant>,
    last_alerted: HashMap<String, Instant>,
}

static MEMORY: LazyLock<Mutex<WatchMemory>> = LazyLock::new(Mutex::default);

#[derive(Debug, Default, PartialEq, Eq)]
pub struct StuckIntentReport {
    pub checked: usize,
    pub unstamped: usize,
    pub stalled: usize,
    pub alerted: usize,
}

pub struct StuckIntentWatch<'a> {
    state: &'a AppState,
    memory: &'a Mutex<WatchMemory>,
    unstamped_grace: Duration,
    stalled_grace: Duration,
    alert_repeat: Duration,
    chain_reads_per_sweep: usize,
}

impl<'a> StuckIntentWatch<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self::with_memory(state, &MEMORY)
    }

    pub fn with_memory(state: &'a AppState, memory: &'a Mutex<WatchMemory>) -> Self {
        Self {
            state,
            memory,
            unstamped_grace: UNSTAMPED_GRACE,
            stalled_grace: STALLED_GRACE,
            alert_repeat: ALERT_REPEAT,
            chain_reads_per_sweep: CHAIN_READS_PER_SWEEP,
        }
    }

    #[cfg(test)]
    fn with_chain_read_budget(mut self, reads: usize) -> Self {
        self.chain_reads_per_sweep = reads;
        self
    }

    #[cfg(test)]
    fn with_graces(mut self, unstamped: Duration, stalled: Duration, repeat: Duration) -> Self {
        self.unstamped_grace = unstamped;
        self.stalled_grace = stalled;
        self.alert_repeat = repeat;
        self
    }

    /// One pass over every pending intent with a proposal. Rows without an
    /// execution hash are checked against chain; stamped rows older than the
    /// grace period are stuck by definition. Rows past their deadline are
    /// left to the poll's expiry path once stamped, and never asked of chain
    /// again once chain reports the proposal finished.
    pub async fn sweep(&self) -> Result<StuckIntentReport, sqlx::Error> {
        let now = Utc::now();
        let rows = self.load_candidates().await?;
        let mut report = StuckIntentReport {
            checked: rows.len(),
            ..StuckIntentReport::default()
        };
        let seen: HashSet<String> = rows.iter().map(CandidateRow::key).collect();
        let (unstamped, stamped): (Vec<CandidateRow>, Vec<CandidateRow>) = rows
            .into_iter()
            .partition(|row| row.proposal_execution_transaction_hash.is_none());
        for row in stamped {
            if row.deadline_passed(now) {
                continue;
            }
            report.stalled += 1;
            if self.alert_due(&row.key()) {
                report.alerted += 1;
                self.alert_stalled(&row, now);
            }
        }
        for row in self.chain_reads_this_sweep(unstamped) {
            let key = row.key();
            self.memory()
                .last_chain_read
                .insert(key.clone(), Instant::now());
            match self.chain_verdict(&row).await {
                ChainVerdict::Approved => {
                    report.unstamped += 1;
                    if self.unstamped_long_enough(&key) && self.alert_due(&key) {
                        report.alerted += 1;
                        self.alert_unstamped(&row, now);
                    }
                }
                ChainVerdict::Open => {
                    self.memory().first_seen_unstamped.remove(&key);
                }
                ChainVerdict::Finished => {
                    self.memory().finished.insert(key);
                }
                ChainVerdict::Unknown => {}
            }
        }
        self.forget_rows_not_in(&seen);
        Ok(report)
    }

    async fn load_candidates(&self) -> Result<Vec<CandidateRow>, sqlx::Error> {
        sqlx::query_as::<_, CandidateRow>(
            r#"
            SELECT dao_id, payload_hash, intent_payload, proposal_id, proposal_executed_at,
                   proposal_execution_transaction_hash, submit_state, submit_attempts,
                   submit_last_error, submit_next_attempt_at
            FROM confidential_intents
            WHERE status = 'pending'
              AND submit_result IS NULL
              AND proposal_id IS NOT NULL
              AND intent_type = ANY($1)
              AND (
                  proposal_execution_transaction_hash IS NULL
                  OR proposal_executed_at <= NOW() - make_interval(secs => $2)
              )
            ORDER BY id
            "#,
        )
        .bind(POLL_SUBMITTED_INTENT_TYPES)
        .bind(self.stalled_grace.as_secs_f64())
        .fetch_all(&self.state.db_pool)
        .await
    }

    async fn chain_verdict(&self, row: &CandidateRow) -> ChainVerdict {
        let dao_account: AccountId = match row.dao_id.parse() {
            Ok(account) => account,
            Err(error) => {
                tracing::warn!(
                    dao_id = %row.dao_id,
                    %error,
                    "stuck-intent watch: invalid DAO account id"
                );
                return ChainVerdict::Unknown;
            }
        };
        let proposal_id = match u64::try_from(row.proposal_id) {
            Ok(id) => id,
            Err(_) => return ChainVerdict::Unknown,
        };
        match fetch_proposal(&self.state.network, &dao_account, proposal_id).await {
            Ok(proposal) => ChainVerdict::from(&proposal.status),
            Err(error) => {
                tracing::warn!(
                    dao_id = %row.dao_id,
                    proposal_id,
                    error = ?error,
                    "stuck-intent watch: could not read the proposal from chain"
                );
                ChainVerdict::Unknown
            }
        }
    }

    /// The unstamped rows chain is asked about this sweep: none chain already
    /// reported finished, least recently read first, at most the per-sweep
    /// budget. The rest wait for the next sweep.
    fn chain_reads_this_sweep(&self, unstamped: Vec<CandidateRow>) -> Vec<CandidateRow> {
        let memory = self.memory();
        let mut rows: Vec<CandidateRow> = unstamped
            .into_iter()
            .filter(|row| !memory.finished.contains(&row.key()))
            .collect();
        rows.sort_by_key(|row| memory.last_chain_read.get(&row.key()).copied());
        rows.truncate(self.chain_reads_per_sweep);
        rows
    }

    fn memory(&self) -> MutexGuard<'_, WatchMemory> {
        self.memory
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Records the first sighting; true once the row has been approved and
    /// unstamped for the whole grace period.
    fn unstamped_long_enough(&self, key: &str) -> bool {
        let mut memory = self.memory();
        let first_seen = *memory
            .first_seen_unstamped
            .entry(key.to_owned())
            .or_insert_with(Instant::now);
        first_seen.elapsed() >= self.unstamped_grace
    }

    /// Claims the alert slot for this sweep when the last one is old enough.
    fn alert_due(&self, key: &str) -> bool {
        let mut memory = self.memory();
        let due = memory
            .last_alerted
            .get(key)
            .is_none_or(|at| at.elapsed() >= self.alert_repeat);
        if due {
            memory.last_alerted.insert(key.to_owned(), Instant::now());
        }
        due
    }

    fn forget_rows_not_in(&self, seen: &HashSet<String>) {
        let mut memory = self.memory();
        memory.finished.retain(|key| seen.contains(key));
        memory
            .first_seen_unstamped
            .retain(|key, _| seen.contains(key));
        memory.last_chain_read.retain(|key, _| seen.contains(key));
        memory.last_alerted.retain(|key, _| seen.contains(key));
    }

    fn alert_unstamped(&self, row: &CandidateRow, now: DateTime<Utc>) {
        error_event!(
            ErrorCode::ConfIntentExecutionUnstamped,
            dao_id = %row.dao_id,
            payload_hash = %row.payload_hash,
            proposal_id = row.proposal_id,
            submit_state = %row.submit_state,
            proposal_executed_at = ?row.proposal_executed_at,
            deadline = ?row.deadline(),
            deadline_passed = row.deadline_passed(now)
        );
    }

    fn alert_stalled(&self, row: &CandidateRow, now: DateTime<Utc>) {
        let executed_seconds_ago = row
            .proposal_executed_at
            .map(|at| (now - at).num_seconds())
            .unwrap_or_default();
        error_event!(
            ErrorCode::ConfIntentSubmitStalled,
            dao_id = %row.dao_id,
            payload_hash = %row.payload_hash,
            proposal_id = row.proposal_id,
            submit_state = %row.submit_state,
            submit_attempts = row.submit_attempts,
            submit_last_error = row.submit_last_error.as_deref().unwrap_or(""),
            submit_next_attempt_at = ?row.submit_next_attempt_at,
            executed_seconds_ago,
            deadline = ?row.deadline()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::test_utils::build_test_state;
    use base64::Engine as _;
    use base64::prelude::BASE64_STANDARD;
    use near_api::{NetworkConfig, RPCEndpoint};
    use sqlx::PgPool;
    use wiremock::{MockServer, Request, Respond, ResponseTemplate};

    const DAO: &str = "watch.sputnik-dao.near";
    const TX_HASH: &str = "6TdwKKX7Nn7TcJ3b5q6j5mCq3kqcZ4R5dT8mS1aWvE9x";

    /// NEAR JSON-RPC stub answering every `get_proposal` view with one status.
    struct ProposalRpcStub(&'static str);

    impl Respond for ProposalRpcStub {
        fn respond(&self, request: &Request) -> ResponseTemplate {
            let body: Value = serde_json::from_slice(&request.body).expect("json-rpc body");
            assert_eq!(body["method"], "query", "unexpected RPC call: {body}");
            assert_eq!(body["params"]["method_name"], "get_proposal");
            let proposal = serde_json::json!({
                "id": 29,
                "proposer": "alice.near",
                "description": "",
                "kind": { "FunctionCall": { "receiver_id": "v1.signer", "actions": [] } },
                "status": self.0,
                "vote_counts": {},
                "votes": {},
                "submission_time": "1762900000000000000"
            });
            ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": body["id"],
                "result": {
                    "result": serde_json::to_vec(&proposal).expect("encode proposal"),
                    "logs": [],
                    "block_height": 224221329,
                    "block_hash": "11111111111111111111111111111111"
                }
            }))
        }
    }

    async fn rpc_saying(status: &'static str) -> MockServer {
        let rpc = MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .respond_with(ProposalRpcStub(status))
            .mount(&rpc)
            .await;
        rpc
    }

    fn state_with_rpc(pool: PgPool, rpc: &MockServer) -> AppState {
        let mut state = build_test_state(pool);
        state.network = NetworkConfig {
            rpc_endpoints: vec![RPCEndpoint::new(rpc.uri().parse().expect("mock url"))],
            ..NetworkConfig::mainnet()
        };
        state
    }

    fn intent_payload(deadline: &str) -> Value {
        serde_json::json!({
            "message": serde_json::json!({ "deadline": deadline }).to_string()
        })
    }

    async fn seed_unstamped(pool: &PgPool, payload_hash: &str, deadline: &str) {
        seed_unstamped_for_proposal(pool, payload_hash, deadline, 29).await;
    }

    async fn seed_unstamped_for_proposal(
        pool: &PgPool,
        payload_hash: &str,
        deadline: &str,
        proposal_id: i64,
    ) {
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id, submit_state
            )
            VALUES ($1, $2, $3, 'shield', 'pending', $4, 'idle')
            "#,
        )
        .bind(DAO)
        .bind(payload_hash)
        .bind(intent_payload(deadline))
        .bind(proposal_id)
        .execute(pool)
        .await
        .expect("seed intent");
    }

    /// The proposal id a recorded `get_proposal` view call asked for.
    fn proposal_id_asked(request: &Request) -> u64 {
        let body: Value = serde_json::from_slice(&request.body).expect("json-rpc body");
        let args = BASE64_STANDARD
            .decode(body["params"]["args_base64"].as_str().expect("args_base64"))
            .expect("base64 args");
        serde_json::from_slice::<Value>(&args).expect("json args")["id"]
            .as_u64()
            .expect("proposal id")
    }

    async fn seed_stamped(
        pool: &PgPool,
        payload_hash: &str,
        deadline: &str,
        executed_secs_ago: i64,
    ) {
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id, submit_state,
                proposal_executed_at, proposal_execution_transaction_hash, submit_next_attempt_at
            )
            VALUES ($1, $2, $3, 'shield', 'pending', 29, 'due',
                    NOW() - make_interval(secs => $4), $5, NOW())
            "#,
        )
        .bind(DAO)
        .bind(payload_hash)
        .bind(intent_payload(deadline))
        .bind(executed_secs_ago as f64)
        .bind(TX_HASH)
        .execute(pool)
        .await
        .expect("seed intent");
    }

    fn immediate<'a>(state: &'a AppState, memory: &'a Mutex<WatchMemory>) -> StuckIntentWatch<'a> {
        StuckIntentWatch::with_memory(state, memory).with_graces(
            Duration::ZERO,
            STALLED_GRACE,
            ALERT_REPEAT,
        )
    }

    #[sqlx::test]
    async fn approved_unstamped_intent_alerts_once_per_repeat(pool: PgPool) {
        let rpc = rpc_saying("Approved").await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_unstamped(&pool, "stuck", "2099-01-01T00:00:00Z").await;
        let memory = Mutex::new(WatchMemory::default());
        let watch = immediate(&state, &memory);

        let report = watch.sweep().await.expect("sweep");
        assert_eq!(
            report,
            StuckIntentReport {
                checked: 1,
                unstamped: 1,
                stalled: 0,
                alerted: 1
            }
        );

        let report = watch.sweep().await.expect("sweep");
        assert_eq!(report.unstamped, 1, "still stuck");
        assert_eq!(report.alerted, 0, "alert repeats only after the interval");
    }

    #[sqlx::test]
    async fn approved_unstamped_intent_waits_out_the_grace(pool: PgPool) {
        let rpc = rpc_saying("Approved").await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_unstamped(&pool, "fresh", "2099-01-01T00:00:00Z").await;
        let memory = Mutex::new(WatchMemory::default());
        let watch = StuckIntentWatch::with_memory(&state, &memory);

        let report = watch.sweep().await.expect("sweep");
        assert_eq!(report.unstamped, 1);
        assert_eq!(report.alerted, 0, "first sighting starts the grace clock");
    }

    #[sqlx::test]
    async fn open_proposal_is_not_stuck(pool: PgPool) {
        let rpc = rpc_saying("InProgress").await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_unstamped(&pool, "unvoted", "2099-01-01T00:00:00Z").await;
        let memory = Mutex::new(WatchMemory::default());

        let report = immediate(&state, &memory).sweep().await.expect("sweep");
        assert_eq!(
            report,
            StuckIntentReport {
                checked: 1,
                ..StuckIntentReport::default()
            }
        );
    }

    #[sqlx::test]
    async fn finished_proposal_is_asked_of_chain_once(pool: PgPool) {
        let rpc = rpc_saying("Rejected").await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_unstamped(&pool, "rejected", "2099-01-01T00:00:00Z").await;
        let memory = Mutex::new(WatchMemory::default());
        let watch = immediate(&state, &memory);

        for _ in 0..3 {
            let report = watch.sweep().await.expect("sweep");
            assert_eq!(report.unstamped, 0);
            assert_eq!(report.alerted, 0);
        }
        let calls = rpc.received_requests().await.expect("recorded").len();
        assert_eq!(calls, 1, "a finished proposal is not re-read every sweep");
    }

    #[sqlx::test]
    async fn stamped_intent_unsubmitted_past_grace_is_stalled(pool: PgPool) {
        let rpc = MockServer::start().await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_stamped(&pool, "stalled", "2099-01-01T00:00:00Z", 3600).await;
        seed_stamped(&pool, "recent", "2099-01-01T00:00:00Z", 30).await;
        seed_stamped(&pool, "expired", "2020-01-01T00:00:00Z", 3600).await;
        let memory = Mutex::new(WatchMemory::default());

        let report = StuckIntentWatch::with_memory(&state, &memory)
            .sweep()
            .await
            .expect("sweep");
        assert_eq!(
            report,
            StuckIntentReport {
                checked: 2,
                unstamped: 0,
                stalled: 1,
                alerted: 1
            },
            "the recent row is inside the grace, the expired one belongs to the poll"
        );
        assert!(
            rpc.received_requests().await.expect("recorded").is_empty(),
            "stamped rows never need chain"
        );
    }

    #[sqlx::test]
    async fn chain_reads_are_budgeted_per_sweep_and_rotate(pool: PgPool) {
        let rpc = rpc_saying("InProgress").await;
        let state = state_with_rpc(pool.clone(), &rpc);
        for proposal_id in [31, 32, 33] {
            seed_unstamped_for_proposal(
                &pool,
                &format!("open-{proposal_id}"),
                "2099-01-01T00:00:00Z",
                proposal_id,
            )
            .await;
        }
        let memory = Mutex::new(WatchMemory::default());
        let watch = immediate(&state, &memory).with_chain_read_budget(2);

        watch.sweep().await.expect("sweep");
        assert_eq!(rpc.received_requests().await.expect("recorded").len(), 2);

        watch.sweep().await.expect("sweep");
        let requests = rpc.received_requests().await.expect("recorded");
        assert_eq!(requests.len(), 4, "two chain reads per sweep");
        let asked: HashSet<u64> = requests.iter().map(proposal_id_asked).collect();
        assert_eq!(
            asked,
            HashSet::from([31, 32, 33]),
            "the row skipped by the first sweep is read first by the second"
        );
    }

    #[sqlx::test]
    async fn bulk_auth_rows_are_watched_too(pool: PgPool) {
        let rpc = MockServer::start().await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_stamped(&pool, "activation", "2099-01-01T00:00:00Z", 3600).await;
        sqlx::query("UPDATE confidential_intents SET intent_type = 'bulk_auth'")
            .execute(&pool)
            .await
            .expect("retype");
        let memory = Mutex::new(WatchMemory::default());

        let report = StuckIntentWatch::with_memory(&state, &memory)
            .sweep()
            .await
            .expect("sweep");
        assert_eq!(report.stalled, 1);
        assert_eq!(report.alerted, 1);
    }

    #[sqlx::test]
    async fn submitted_rows_are_ignored(pool: PgPool) {
        let rpc = MockServer::start().await;
        let state = state_with_rpc(pool.clone(), &rpc);
        seed_stamped(&pool, "done", "2099-01-01T00:00:00Z", 3600).await;
        sqlx::query(
            "UPDATE confidential_intents SET status = 'submitted', submit_result = '{\"intentHash\":\"x\"}'::jsonb, submit_state = 'done'",
        )
        .execute(&pool)
        .await
        .expect("mark submitted");
        let memory = Mutex::new(WatchMemory::default());

        let report = StuckIntentWatch::with_memory(&state, &memory)
            .sweep()
            .await
            .expect("sweep");
        assert_eq!(report, StuckIntentReport::default());
    }
}
