//! Shared reliability policy for every PostgreSQL-backed background-job queue.
//!
//! Apalis 1.0.0-rc.8's PostgreSQL fetcher increases its delay after every
//! empty fetch (up to five minutes) and does not consult `Config`'s poll
//! strategy.  Sparse queues therefore need a local fetcher whose idle cadence
//! is predictable.  This module deliberately keeps Apalis's SQL function,
//! heartbeat, lock and acknowledgement implementations; only the scheduling
//! of claim queries is replaced.

use std::collections::{HashMap, VecDeque};
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::{Arc, LazyLock, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use apalis_core::backend::codec::Codec;
use apalis_core::backend::{Backend, BackendExt, TaskStream};
use apalis_core::layers::Stack;
use apalis_core::worker::context::WorkerContext;
use apalis_postgres::{
    CompactType, Config, JsonCodec, LockTaskLayer, PgAck, PgContext, PgPollFetcher, PgTask,
    PostgresStorage, keep_alive_stream,
};
use apalis_sql::TaskRow;
use futures::stream::{self, BoxStream};
use futures::{Sink, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use sqlx::{PgPool, postgres::PgListener};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(1);
pub const DEFAULT_CLAIM_ALERT_AFTER: Duration = Duration::from_secs(10);
pub const DEFAULT_QUEUE_BACKLOG_ALERT_AFTER: Duration = Duration::from_secs(30 * 60);
pub const DEFAULT_QUEUED_RECLAIM_AFTER: Duration = Duration::from_secs(5 * 60);
pub const MIN_RUNNING_RECLAIM_AFTER: Duration = Duration::from_secs(60 * 60);

const DB_ERROR_BACKOFF_INITIAL: Duration = Duration::from_secs(1);
const DB_ERROR_BACKOFF_MAX: Duration = Duration::from_secs(30);
const JITTER_MIN_PERCENT: u64 = 80;
/// Heartbeats a registered worker may miss before a rebuilt worker with the
/// same id treats it as dead and takes the id over.
const REGISTRATION_STALE_HEARTBEATS: u32 = 3;
const STORAGE_NAME: &str = "TrezuSteadyPostgresStorage";
/// `storage_name` of a registration whose process drained its workers and
/// handed the id back, so a successor need not wait for the heartbeat to age.
const RELEASED_STORAGE_NAME: &str = "TrezuSteadyPostgresStorage:released";
/// Identifies this process in `apalis.workers.storage_name`.
static PROCESS_INSTANCE: LazyLock<Uuid> = LazyLock::new(Uuid::new_v4);

fn process_storage_name() -> String {
    format!("{STORAGE_NAME}:{}", *PROCESS_INSTANCE)
}
const NOTIFY_CHANNEL: &str = "apalis::job::insert";

fn steady_poller_enabled(queue: &str) -> bool {
    if let Ok(allowlist) = std::env::var("APALIS_STEADY_POLLER_QUEUES")
        && !allowlist.trim().is_empty()
    {
        return allowlist
            .split(',')
            .map(str::trim)
            .any(|candidate| candidate == queue);
    }
    !std::env::var("APALIS_STEADY_POLLER_ENABLED").is_ok_and(|value| {
        value == "0" || value.eq_ignore_ascii_case("false") || value.eq_ignore_ascii_case("off")
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueKind {
    Cron { interval_secs: u64 },
    Queue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WakeMode {
    PollOnly,
    Notify,
}

#[derive(Clone, Copy, Debug)]
pub struct ReclaimPolicy {
    pub queued_after: Duration,
    pub running_after: Duration,
}

#[derive(Clone, Debug)]
pub struct QueueSpec {
    pub queue: &'static str,
    /// Stable apalis worker id consuming this queue (`apalis.workers.id`).
    /// Defaults to the queue name; the public-history consumers register
    /// under a different id.
    pub worker_id: &'static str,
    pub kind: QueueKind,
    pub concurrency: usize,
    pub fetch_batch: usize,
    pub poll_interval: Duration,
    pub wake_mode: WakeMode,
    pub handler_timeout: Duration,
    pub claim_alert_after: Duration,
    pub backlog_alert_after: Duration,
    pub reclaim: ReclaimPolicy,
}

impl QueueSpec {
    pub fn cron(
        queue: &'static str,
        interval_secs: u64,
        concurrency: usize,
        handler_timeout: Duration,
    ) -> Self {
        let concurrency = concurrency.max(1);
        Self {
            queue,
            worker_id: queue,
            kind: QueueKind::Cron { interval_secs },
            concurrency,
            fetch_batch: concurrency,
            poll_interval: DEFAULT_POLL_INTERVAL,
            wake_mode: WakeMode::PollOnly,
            handler_timeout,
            claim_alert_after: DEFAULT_CLAIM_ALERT_AFTER,
            backlog_alert_after: Duration::from_secs(
                interval_secs.saturating_mul(2).saturating_add(600),
            ),
            reclaim: ReclaimPolicy {
                queued_after: DEFAULT_QUEUED_RECLAIM_AFTER,
                running_after: handler_timeout
                    .saturating_mul(2)
                    .max(MIN_RUNNING_RECLAIM_AFTER),
            },
        }
    }

    pub fn queue(queue: &'static str, concurrency: usize, handler_timeout: Duration) -> Self {
        let concurrency = concurrency.max(1);
        Self {
            queue,
            worker_id: queue,
            kind: QueueKind::Queue,
            concurrency,
            fetch_batch: concurrency,
            poll_interval: DEFAULT_POLL_INTERVAL,
            wake_mode: WakeMode::PollOnly,
            handler_timeout,
            claim_alert_after: DEFAULT_CLAIM_ALERT_AFTER,
            backlog_alert_after: DEFAULT_QUEUE_BACKLOG_ALERT_AFTER,
            reclaim: ReclaimPolicy {
                queued_after: DEFAULT_QUEUED_RECLAIM_AFTER,
                running_after: handler_timeout
                    .saturating_mul(2)
                    .max(MIN_RUNNING_RECLAIM_AFTER),
            },
        }
    }

    #[must_use]
    pub fn with_notify(mut self) -> Self {
        self.wake_mode = WakeMode::Notify;
        self
    }

    #[must_use]
    pub fn with_backlog_alert_after(mut self, after: Duration) -> Self {
        self.backlog_alert_after = after;
        self
    }

    #[must_use]
    pub fn with_worker_id(mut self, worker_id: &'static str) -> Self {
        self.worker_id = worker_id;
        self
    }
}

/// A process-local fan-out for PostgreSQL insert notifications. One elected
/// leader owns one listener connection regardless of the number of queues.
#[derive(Clone, Default)]
pub struct JobWakeHub {
    queues: Arc<Mutex<HashMap<String, watch::Sender<u64>>>>,
}

impl JobWakeHub {
    pub fn subscribe(&self, queue: &str) -> watch::Receiver<u64> {
        let mut queues = self
            .queues
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        queues
            .entry(queue.to_owned())
            .or_insert_with(|| watch::channel(0).0)
            .subscribe()
    }

    pub(crate) fn wake_queue(&self, queue: &str) {
        let mut queues = self
            .queues
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let sender = queues
            .entry(queue.to_owned())
            .or_insert_with(|| watch::channel(0).0);
        let next = {
            let current = sender.borrow();
            current.wrapping_add(1)
        };
        sender.send_replace(next);
    }

    /// Reconnects forever with bounded backoff. Notification loss is safe:
    /// every consumer also performs fixed one-second polling.
    pub async fn run(self, pool: PgPool, shutdown: CancellationToken) {
        let mut backoff = DB_ERROR_BACKOFF_INITIAL;
        loop {
            if shutdown.is_cancelled() {
                return;
            }

            let connected = tokio::select! {
                _ = shutdown.cancelled() => return,
                result = PgListener::connect_with(&pool) => result,
            };
            match connected {
                Ok(mut listener) => {
                    let listening = tokio::select! {
                        _ = shutdown.cancelled() => return,
                        result = listener.listen(NOTIFY_CHANNEL) => result,
                    };
                    match listening {
                        Ok(()) => {
                            tracing::info!(channel = NOTIFY_CHANNEL, "job wake listener connected");
                            backoff = DB_ERROR_BACKOFF_INITIAL;
                            loop {
                                tokio::select! {
                                    _ = shutdown.cancelled() => return,
                                    notification = listener.recv() => match notification {
                                        Ok(notification) => {
                                            match serde_json::from_str::<InsertEvent>(notification.payload()) {
                                                Ok(event) => self.wake_queue(&event.job_type),
                                                Err(error) => tracing::warn!(
                                                    error = %error,
                                                    payload = notification.payload(),
                                                    "ignored invalid apalis insert notification"
                                                ),
                                            }
                                        }
                                        Err(error) => {
                                            tracing::warn!(error = %error, "job wake listener disconnected");
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            tracing::warn!(error = %error, "job wake listener failed to LISTEN");
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(error = %error, "job wake listener connection failed");
                }
            }

            let delay = jitter(backoff);
            backoff = backoff.saturating_mul(2).min(DB_ERROR_BACKOFF_MAX);
            tokio::select! {
                _ = shutdown.cancelled() => return,
                _ = tokio::time::sleep(delay) => {}
            }
        }
    }
}

#[derive(Deserialize)]
struct InsertEvent {
    job_type: String,
}

#[derive(Debug, Default, Eq, PartialEq, sqlx::FromRow)]
pub(crate) struct StartupReclaimStats {
    pub requeued: i64,
    pub killed: i64,
    pub notified: i64,
}

/// Repairs claims left by a dead predecessor that used the same stable Apalis
/// worker id. This runs after registration succeeds and before the replacement
/// worker can poll its first task, so every older lock owned by this id belongs
/// to a prior incarnation.
///
/// Queued work has not entered a handler and is safe to requeue. Running work
/// has ambiguous side effects and is killed instead. Both states have their
/// lock cleared so a late acknowledgement from the predecessor is fenced out.
pub(crate) async fn reclaim_predecessor_locks(
    pool: &PgPool,
    worker_id: &str,
    queue: &str,
) -> Result<StartupReclaimStats, sqlx::Error> {
    let stats = sqlx::query_as::<_, StartupReclaimStats>(
        r#"
        WITH startup AS MATERIALIZED (
            SELECT clock_timestamp() AS started_at
        ),
        marked_worker AS (
            UPDATE apalis.workers AS worker
            SET started_at = startup.started_at
            FROM startup
            WHERE worker.id = $1
            RETURNING worker.id
        ),
        candidates AS MATERIALIZED (
            SELECT job.id,
                   job.job_type,
                   job.status AS from_status,
                   job.lock_at,
                   job.run_at,
                   startup.started_at
            FROM apalis.jobs AS job
            CROSS JOIN startup
            WHERE job.lock_by = $1
              AND job.job_type = $2
              AND job.status IN ('Queued', 'Running')
              AND job.lock_at IS NOT NULL
              AND job.lock_at < startup.started_at
              AND EXISTS (SELECT 1 FROM marked_worker)
            FOR UPDATE OF job
        ),
        updated AS (
            UPDATE apalis.jobs AS job
            SET status = CASE candidates.from_status
                    WHEN 'Queued' THEN 'Pending'
                    ELSE 'Killed'
                END,
                lock_by = NULL,
                lock_at = NULL,
                done_at = CASE candidates.from_status
                    WHEN 'Running' THEN candidates.started_at
                    ELSE NULL
                END,
                last_result = CASE candidates.from_status
                    WHEN 'Running' THEN jsonb_build_object(
                        'Err',
                        'Platform startup reclaim: predecessor execution was interrupted'
                    )
                    ELSE job.last_result
                END
            FROM candidates
            WHERE job.id = candidates.id
            RETURNING job.id
        ),
        audited AS (
            INSERT INTO background_job_reclaims (
                job_id,
                job_type,
                from_status,
                action,
                reason,
                lock_at,
                reclaimed_at
            )
            SELECT candidates.id,
                   candidates.job_type,
                   candidates.from_status,
                   CASE candidates.from_status
                       WHEN 'Queued' THEN 'startup_requeued'
                       ELSE 'startup_killed'
                   END,
                   CASE candidates.from_status
                       WHEN 'Queued' THEN
                           'stable worker id restarted after predecessor claim'
                       ELSE
                           'stable worker id restarted after ambiguous predecessor execution'
                   END,
                   candidates.lock_at,
                   candidates.started_at
            FROM candidates
            JOIN updated USING (id)
            RETURNING from_status
        ),
        notified AS (
            SELECT pg_notify(
                'apalis::job::insert',
                json_build_object(
                    'job_type', candidates.job_type,
                    'id', candidates.id,
                    'run_at', candidates.run_at
                )::text
            )
            FROM candidates
            JOIN updated USING (id)
            WHERE candidates.from_status = 'Queued'
        )
        SELECT COUNT(*) FILTER (WHERE from_status = 'Queued')::bigint AS requeued,
               COUNT(*) FILTER (WHERE from_status = 'Running')::bigint AS killed,
               (SELECT COUNT(*)::bigint FROM notified) AS notified
        FROM audited
        "#,
    )
    .bind(worker_id)
    .bind(queue)
    .fetch_one(pool)
    .await?;

    if stats.requeued > 0 || stats.killed > 0 {
        tracing::warn!(
            worker = worker_id,
            queue,
            requeued = stats.requeued,
            killed = stats.killed,
            notified = stats.notified,
            "recovered claims left by a previous worker incarnation"
        );
    }
    Ok(stats)
}

async fn register_worker_and_reclaim(
    pool: &PgPool,
    config: &Config,
    worker: &WorkerContext,
) -> Result<(), sqlx::Error> {
    // This mirrors Apalis's private worker-registration query, but deliberately
    // does not call its generic orphan recovery first: that routine requeues
    // both Queued and Running jobs, while the platform must kill ambiguous
    // Running executions. Registration remains the exclusivity gate.
    let stale_after = config
        .keep_alive()
        .saturating_mul(REGISTRATION_STALE_HEARTBEATS);
    register_worker(pool, config, worker, stale_after).await?;
    reclaim_predecessor_locks(pool, worker.name(), config.queue().as_ref()).await?;
    Ok(())
}

/// Registers this worker under its stable id.
///
/// The id is taken over when the previous registration came from this process
/// (supervisors only rebuild a worker after the old one has finished, so it is
/// dead), was released by a process that shut down cleanly
/// ([`release_worker_registrations`]), or has a heartbeat older than
/// `stale_after` (another process that lost leadership and has since drained). A fresh heartbeat from another
/// process yields `WORKER_ALREADY_EXISTS` for the supervisor to retry with
/// backoff. Unlike a session-level advisory lock, nothing here outlives the
/// statement on a pooled connection.
pub(crate) async fn register_worker(
    pool: &PgPool,
    config: &Config,
    worker: &WorkerContext,
    stale_after: Duration,
) -> Result<(), sqlx::Error> {
    let registered = sqlx::query(
        r#"
        INSERT INTO apalis.workers (
            id, worker_type, storage_name, layers, last_seen
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
            worker_type = EXCLUDED.worker_type,
            storage_name = EXCLUDED.storage_name,
            layers = EXCLUDED.layers,
            last_seen = NOW()
        WHERE apalis.workers.storage_name IN (EXCLUDED.storage_name, $6)
           OR apalis.workers.last_seen < NOW() - make_interval(secs => $5)
        "#,
    )
    .bind(worker.name())
    .bind(config.queue().to_string())
    .bind(process_storage_name())
    .bind(worker.get_service())
    .bind(stale_after.as_secs_f64())
    .bind(RELEASED_STORAGE_NAME)
    .execute(pool)
    .await?;
    if registered.rows_affected() == 0 {
        return Err(sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            "WORKER_ALREADY_EXISTS",
        )));
    }
    Ok(())
}

/// Hands back every worker id this process registered. Only call once all of
/// its workers have stopped: the next registration takes the ids over at once.
pub(crate) async fn release_worker_registrations(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let released =
        sqlx::query("UPDATE apalis.workers SET storage_name = $2 WHERE storage_name = $1")
            .bind(process_storage_name())
            .bind(RELEASED_STORAGE_NAME)
            .execute(pool)
            .await?;
    Ok(released.rows_affected())
}

/// A heartbeat that fails on a transient database error (a pool-acquire timeout
/// under connection starvation) must not end the worker: only a run of
/// `REGISTRATION_STALE_HEARTBEATS` consecutive failures does, which is also
/// when the registration stops protecting the worker id. Any other error,
/// such as `WORKER_DOES_NOT_EXIST`, ends it at once.
fn tolerate_missed_heartbeats(
    beats: impl Stream<Item = Result<(), sqlx::Error>> + Send + 'static,
    worker_id: String,
) -> impl Stream<Item = Result<(), sqlx::Error>> + Send + 'static {
    let mut missed = 0u32;
    beats.map(move |beat| match beat {
        Ok(()) => {
            missed = 0;
            Ok(())
        }
        Err(error) => {
            missed += 1;
            if !is_transient_db_error(&error) || missed >= REGISTRATION_STALE_HEARTBEATS {
                return Err(error);
            }
            tracing::warn!(worker = %worker_id, %error, missed, "job worker heartbeat failed");
            Ok(())
        }
    })
}

/// Database errors that clear on their own and say nothing about the worker.
/// Apalis reports registration failures (`WORKER_DOES_NOT_EXIST`,
/// `WORKER_ALREADY_EXISTS`) as `Io` too, so only connection-level kinds count.
fn is_transient_db_error(error: &sqlx::Error) -> bool {
    use std::io::ErrorKind;
    match error {
        sqlx::Error::PoolTimedOut => true,
        sqlx::Error::Io(io) => matches!(
            io.kind(),
            ErrorKind::ConnectionRefused
                | ErrorKind::ConnectionReset
                | ErrorKind::ConnectionAborted
                | ErrorKind::NotConnected
                | ErrorKind::BrokenPipe
                | ErrorKind::TimedOut
                | ErrorKind::UnexpectedEof
        ),
        _ => false,
    }
}

fn jitter(delay: Duration) -> Duration {
    let percent = rand::random_range(JITTER_MIN_PERCENT..=100);
    Duration::from_millis(
        delay
            .as_millis()
            .saturating_mul(u128::from(percent))
            .checked_div(100)
            .unwrap_or_default()
            .min(u128::from(u64::MAX)) as u64,
    )
}

/// Delay before rebuilding a worker after an unexpected exit. Attempt zero is
/// the initial start and must be immediate; subsequent attempts use the same
/// bounded jittered backoff as database-error recovery.
pub fn worker_restart_delay(attempt: usize) -> Duration {
    if attempt == 0 {
        return Duration::ZERO;
    }
    let exponent = u32::try_from(attempt.saturating_sub(1)).unwrap_or(u32::MAX);
    let multiplier = 2_u32.checked_pow(exponent).unwrap_or(u32::MAX);
    jitter(
        DB_ERROR_BACKOFF_INITIAL
            .saturating_mul(multiplier)
            .min(DB_ERROR_BACKOFF_MAX),
    )
}

#[derive(sqlx::FromRow)]
struct PlatformTaskRow {
    job: Option<Vec<u8>>,
    id: Option<String>,
    job_type: Option<String>,
    status: Option<String>,
    attempts: Option<i32>,
    max_attempts: Option<i32>,
    run_at: Option<DateTime<Utc>>,
    last_result: Option<serde_json::Value>,
    lock_at: Option<DateTime<Utc>>,
    lock_by: Option<String>,
    done_at: Option<DateTime<Utc>>,
    priority: Option<i32>,
    idempotency_key: Option<String>,
    metadata: Option<serde_json::Value>,
}

impl TryFrom<PlatformTaskRow> for TaskRow {
    type Error = sqlx::Error;

    fn try_from(row: PlatformTaskRow) -> Result<Self, Self::Error> {
        Ok(Self {
            job: row.job.unwrap_or_default(),
            id: row
                .id
                .ok_or_else(|| sqlx::Error::Protocol("apalis row missing id".to_owned()))?,
            job_type: row
                .job_type
                .ok_or_else(|| sqlx::Error::Protocol("apalis row missing job_type".to_owned()))?,
            status: row
                .status
                .ok_or_else(|| sqlx::Error::Protocol("apalis row missing status".to_owned()))?,
            attempts: row.attempts.unwrap_or_default().max(0) as usize,
            max_attempts: row.max_attempts.map(|value| value.max(0) as usize),
            run_at: row.run_at,
            last_result: row.last_result,
            lock_at: row.lock_at,
            lock_by: row.lock_by,
            done_at: row.done_at,
            priority: row.priority.map(|value| value.max(0) as usize),
            idempotency_key: row.idempotency_key,
            metadata: row.metadata,
        })
    }
}

async fn fetch_next(
    pool: &PgPool,
    config: &Config,
    worker: &WorkerContext,
) -> Result<Vec<PgTask<CompactType>>, sqlx::Error> {
    let rows = sqlx::query_as::<_, PlatformTaskRow>("SELECT * FROM apalis.get_jobs($1, $2, $3)")
        .bind(worker.name())
        .bind(config.queue().to_string())
        .bind(config.buffer_size() as i32)
        .fetch_all(pool)
        .await?;

    rows.into_iter()
        .map(|row| {
            let row = TaskRow::try_from(row)?;
            row.try_into_task_compact()
                .map_err(|error| sqlx::Error::Protocol(error.to_string()))
        })
        .collect()
}

struct PollState {
    pool: PgPool,
    config: Config,
    worker: WorkerContext,
    wake: Option<watch::Receiver<u64>>,
    buffered: VecDeque<PgTask<CompactType>>,
    wait_before_fetch: Option<(Duration, bool)>,
    error_backoff: Duration,
}

impl PollState {
    async fn wait(&mut self, duration: Duration, notification_can_bypass: bool) {
        if notification_can_bypass && let Some(wake) = &mut self.wake {
            tokio::select! {
                _ = tokio::time::sleep(duration) => {},
                changed = wake.changed() => {
                    if changed.is_err() {
                        self.wake = None;
                    }
                }
            }
        } else {
            tokio::time::sleep(duration).await;
        }
    }
}

fn steady_stream(
    pool: PgPool,
    config: Config,
    worker: WorkerContext,
    wake: Option<watch::Receiver<u64>>,
    poll_interval: Duration,
) -> TaskStream<PgTask<CompactType>, sqlx::Error> {
    stream::unfold(
        PollState {
            pool,
            config,
            worker,
            wake,
            buffered: VecDeque::new(),
            wait_before_fetch: None,
            error_backoff: DB_ERROR_BACKOFF_INITIAL,
        },
        move |mut state| async move {
            loop {
                if let Some(task) = state.buffered.pop_front() {
                    return Some((Ok(Some(task)), state));
                }

                if let Some((delay, notification_can_bypass)) = state.wait_before_fetch.take() {
                    state.wait(delay, notification_can_bypass).await;
                }

                match fetch_next(&state.pool, &state.config, &state.worker).await {
                    Ok(tasks) if tasks.is_empty() => {
                        state.error_backoff = DB_ERROR_BACKOFF_INITIAL;
                        state.wait_before_fetch = Some((poll_interval, true));
                    }
                    Ok(tasks) => {
                        state.error_backoff = DB_ERROR_BACKOFF_INITIAL;
                        state.buffered.extend(tasks);
                        // No delay: drain the claimed batch and immediately fetch
                        // again once the worker has capacity.
                    }
                    Err(error) => {
                        let delay = jitter(state.error_backoff);
                        state.error_backoff = state
                            .error_backoff
                            .saturating_mul(2)
                            .min(DB_ERROR_BACKOFF_MAX);
                        state.wait_before_fetch = Some((delay, false));
                        tracing::warn!(
                            queue = %state.config.queue(),
                            worker = %state.worker.name(),
                            error = %error,
                            retry_delay_ms = delay.as_millis(),
                            "job claim query failed; retrying with bounded backoff"
                        );
                        // Claim failures are recoverable backend conditions,
                        // not an end-of-stream signal. Keeping the state here
                        // preserves exponential backoff across retries and
                        // prevents the worker supervisor from hot-looping.
                    }
                }
            }
        },
    )
    .boxed()
}

/// Worker-side storage using fixed idle polling. The contained ordinary
/// storage remains the sink, preserving cron piping and manual enqueue APIs.
pub struct SteadyPostgresStorage<Args> {
    pool: PgPool,
    config: Config,
    poll_interval: Duration,
    startup_delay: Duration,
    steady_enabled: bool,
    wake: Option<watch::Receiver<u64>>,
    sink: PostgresStorage<Args>,
    /// Whether the current worker attempt has registered. `poll` clears it
    /// when an attempt starts and sets it once registration and reclaim
    /// succeed; the heartbeat waits for it, so an unregistered replacement can
    /// never refresh its predecessor's `last_seen`.
    registered: Arc<watch::Sender<bool>>,
    _args: PhantomData<Args>,
}

impl<Args> Clone for SteadyPostgresStorage<Args> {
    fn clone(&self) -> Self {
        Self {
            pool: self.pool.clone(),
            config: self.config.clone(),
            poll_interval: self.poll_interval,
            startup_delay: self.startup_delay,
            steady_enabled: self.steady_enabled,
            wake: self.wake.clone(),
            sink: self.sink.clone(),
            registered: self.registered.clone(),
            _args: PhantomData,
        }
    }
}

impl<Args> SteadyPostgresStorage<Args> {
    pub fn new(pool: &PgPool, spec: &QueueSpec, wake_hub: &JobWakeHub) -> Self {
        let config = Config::new(spec.queue).set_buffer_size(spec.fetch_batch.max(1));
        let wake = (spec.wake_mode == WakeMode::Notify).then(|| wake_hub.subscribe(spec.queue));
        let steady_enabled = steady_poller_enabled(spec.queue);
        if !steady_enabled {
            tracing::warn!(queue = spec.queue, "using legacy adaptive apalis poller");
        }
        Self {
            pool: pool.clone(),
            sink: PostgresStorage::new_with_config(pool, &config),
            config,
            poll_interval: spec.poll_interval,
            startup_delay: Duration::ZERO,
            steady_enabled,
            wake,
            registered: Arc::new(watch::Sender::new(false)),
            _args: PhantomData,
        }
    }

    #[must_use]
    pub fn with_startup_delay(mut self, delay: Duration) -> Self {
        self.startup_delay = delay;
        self
    }
}

impl<Args> Backend for SteadyPostgresStorage<Args>
where
    Args: Serialize + for<'de> Deserialize<'de> + Send + Unpin + 'static,
{
    type Args = Args;
    type IdType = <PostgresStorage<Args> as Backend>::IdType;
    type Context = PgContext;
    type Error = sqlx::Error;
    type Stream = TaskStream<PgTask<Args>, sqlx::Error>;
    type Beat = BoxStream<'static, Result<(), sqlx::Error>>;
    type Layer = Stack<LockTaskLayer, apalis_core::worker::ext::ack::AcknowledgeLayer<PgAck>>;

    fn heartbeat(&self, worker: &WorkerContext) -> Self::Beat {
        let beats = tolerate_missed_heartbeats(
            keep_alive_stream(self.pool.clone(), self.config.clone(), worker.clone()),
            worker.name().to_owned(),
        );
        let registered = self.registered.clone();
        stream::once(async move {
            // The sender is held here, so this only returns once registered.
            let _ = registered
                .subscribe()
                .wait_for(|registered| *registered)
                .await;
            Ok(())
        })
        .chain(beats)
        .boxed()
    }

    fn middleware(&self) -> Self::Layer {
        Stack::new(
            LockTaskLayer::new(self.pool.clone()),
            apalis_core::worker::ext::ack::AcknowledgeLayer::new(PgAck::new(self.pool.clone())),
        )
    }

    fn poll(self, worker: &WorkerContext) -> Self::Stream {
        self.poll_compact_inner(worker)
            .map(|item| match item {
                Ok(Some(task)) => Ok(Some(
                    task.try_map(|bytes| JsonCodec::<Vec<u8>>::decode(&bytes))
                        .map_err(|error| sqlx::Error::Decode(error.into()))?,
                )),
                Ok(None) => Ok(None),
                Err(error) => Err(error),
            })
            .boxed()
    }
}

impl<Args> SteadyPostgresStorage<Args>
where
    Args: Serialize + for<'de> Deserialize<'de> + Send + Unpin + 'static,
{
    fn poll_compact_inner(
        &self,
        worker: &WorkerContext,
    ) -> TaskStream<PgTask<CompactType>, sqlx::Error> {
        let startup_pool = self.pool.clone();
        let startup_config = self.config.clone();
        let startup_worker = worker.clone();
        let registered = self.registered.clone();
        registered.send_replace(false);
        let register = stream::once(async move {
            register_worker_and_reclaim(&startup_pool, &startup_config, &startup_worker).await?;
            registered.send_replace(true);
            Ok(None)
        });
        let startup_delay = self.startup_delay;
        let wait_for_restart = stream::once(async move {
            if !startup_delay.is_zero() {
                tokio::time::sleep(startup_delay).await;
            }
            Ok(None)
        });
        let startup = wait_for_restart.chain(register);
        if self.steady_enabled {
            startup
                .chain(steady_stream(
                    self.pool.clone(),
                    self.config.clone(),
                    worker.clone(),
                    self.wake.clone(),
                    self.poll_interval,
                ))
                .boxed()
        } else {
            startup
                .chain(PgPollFetcher::<CompactType>::new(
                    &self.pool,
                    &self.config,
                    worker,
                ))
                .boxed()
        }
    }
}

impl<Args> BackendExt for SteadyPostgresStorage<Args>
where
    Args: Serialize + for<'de> Deserialize<'de> + Send + Unpin + 'static,
{
    type Compact = CompactType;
    type Codec = JsonCodec<CompactType>;
    type CompactStream = TaskStream<PgTask<CompactType>, sqlx::Error>;

    fn get_queue(&self) -> apalis_core::backend::queue::Queue {
        self.config.queue().clone()
    }

    fn poll_compact(self, worker: &WorkerContext) -> Self::CompactStream {
        self.poll_compact_inner(worker)
    }
}

impl<Args> Sink<PgTask<CompactType>> for SteadyPostgresStorage<Args>
where
    Args: Serialize + for<'de> Deserialize<'de> + Send + Sync + Unpin + 'static,
{
    type Error = sqlx::Error;

    fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn start_send(self: Pin<&mut Self>, item: PgTask<CompactType>) -> Result<(), Self::Error> {
        Pin::new(&mut self.get_mut().sink).start_send(item)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        let this = self.get_mut();
        match Pin::new(&mut this.sink).poll_flush(cx) {
            // A sink error ends the piping worker. The inner sink has already
            // dropped the failed batch, so a transient error costs the cron
            // ticks in it and the next tick goes through the same sink.
            Poll::Ready(Err(error)) if is_transient_db_error(&error) => {
                tracing::warn!(
                    queue = %this.config.queue(),
                    %error,
                    "dropped job push on transient database error"
                );
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }

    fn poll_close(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.get_mut().sink).poll_close(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type RepairedJobRow = (String, String, i32, Option<String>, Option<DateTime<Utc>>);

    #[test]
    fn queue_spec_uses_concurrency_as_fetch_bound() {
        let spec = QueueSpec::queue("bounded", 7, Duration::from_secs(30));
        assert_eq!(spec.concurrency, 7);
        assert_eq!(spec.fetch_batch, 7);
        assert_eq!(spec.poll_interval, Duration::from_secs(1));
        assert_eq!(spec.reclaim.queued_after, Duration::from_secs(300));
        assert_eq!(spec.reclaim.running_after, Duration::from_secs(3600));
    }

    #[test]
    fn worker_restart_backoff_is_immediate_then_bounded() {
        assert_eq!(worker_restart_delay(0), Duration::ZERO);
        for attempt in 1..20 {
            let delay = worker_restart_delay(attempt);
            assert!(delay >= Duration::from_millis(800));
            assert!(delay <= Duration::from_secs(30));
        }
    }

    #[tokio::test]
    async fn wake_hub_isolates_namespaces_and_coalesces_duplicates() {
        let hub = JobWakeHub::default();
        let mut first = hub.subscribe("first");
        let second = hub.subscribe("second");

        hub.wake_queue("first");
        hub.wake_queue("first");
        tokio::time::timeout(Duration::from_millis(50), first.changed())
            .await
            .expect("subscribed queue should wake")
            .expect("sender should remain alive");
        assert_eq!(*first.borrow_and_update(), 2);
        assert!(!second.has_changed().expect("sender should remain alive"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn startup_reclaim_repairs_only_predecessor_locks_and_fences_ack(
        pool: PgPool,
    ) -> Result<(), sqlx::Error> {
        crate::jobs::setup_apalis(&pool).await?;
        sqlx::query(
            r#"
            INSERT INTO apalis.workers (id, worker_type, storage_name, layers)
            VALUES
                ('stable-worker', 'restart-test', 'test', ''),
                ('other-worker', 'restart-test', 'test', '')
            "#,
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO apalis.jobs (
                job, id, job_type, status, attempts, run_at, lock_at, lock_by
            ) VALUES
                (decode('7b7d', 'hex'), 'old-queued', 'restart-test', 'Queued', 3,
                 NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute', 'stable-worker'),
                (decode('7b7d', 'hex'), 'old-running', 'restart-test', 'Running', 4,
                 NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute', 'stable-worker'),
                (decode('7b7d', 'hex'), 'other-queue', 'other-queue', 'Running', 5,
                 NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute', 'stable-worker'),
                (decode('7b7d', 'hex'), 'other-owner', 'restart-test', 'Running', 6,
                 NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute', 'other-worker'),
                (decode('7b7d', 'hex'), 'after-boundary', 'restart-test', 'Running', 7,
                 NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '1 minute', 'stable-worker')
            "#,
        )
        .execute(&pool)
        .await?;

        let stats = reclaim_predecessor_locks(&pool, "stable-worker", "restart-test").await?;
        assert_eq!(
            stats,
            StartupReclaimStats {
                requeued: 1,
                killed: 1,
                notified: 1,
            }
        );

        let repaired: Vec<RepairedJobRow> = sqlx::query_as(
            r#"
                SELECT id, status, attempts, lock_by, lock_at
                FROM apalis.jobs
                ORDER BY id
                "#,
        )
        .fetch_all(&pool)
        .await?;
        assert!(
            repaired.contains(&("old-queued".to_owned(), "Pending".to_owned(), 3, None, None,))
        );
        assert!(
            repaired.contains(&("old-running".to_owned(), "Killed".to_owned(), 4, None, None,))
        );
        assert!(repaired.iter().any(|row| {
            row.0 == "other-queue"
                && row.1 == "Running"
                && row.3.as_deref() == Some("stable-worker")
        }));
        assert!(repaired.iter().any(|row| {
            row.0 == "other-owner" && row.1 == "Running" && row.3.as_deref() == Some("other-worker")
        }));
        assert!(repaired.iter().any(|row| {
            row.0 == "after-boundary"
                && row.1 == "Running"
                && row.3.as_deref() == Some("stable-worker")
        }));

        let stale_ack = sqlx::query(
            r#"
            UPDATE apalis.jobs
            SET status = 'Done', done_at = NOW()
            WHERE id = 'old-running' AND lock_by = 'stable-worker'
            "#,
        )
        .execute(&pool)
        .await?;
        assert_eq!(stale_ack.rows_affected(), 0);

        let audit: Vec<(String, String, String)> = sqlx::query_as(
            r#"
            SELECT job_id, from_status, action
            FROM background_job_reclaims
            ORDER BY job_id
            "#,
        )
        .fetch_all(&pool)
        .await?;
        assert_eq!(
            audit,
            vec![
                (
                    "old-queued".to_owned(),
                    "Queued".to_owned(),
                    "startup_requeued".to_owned(),
                ),
                (
                    "old-running".to_owned(),
                    "Running".to_owned(),
                    "startup_killed".to_owned(),
                ),
            ]
        );
        let started_at: Option<DateTime<Utc>> =
            sqlx::query_scalar("SELECT started_at FROM apalis.workers WHERE id = 'stable-worker'")
                .fetch_one(&pool)
                .await?;
        assert!(started_at.is_some());

        assert_eq!(
            reclaim_predecessor_locks(&pool, "stable-worker", "restart-test").await?,
            StartupReclaimStats::default()
        );
        Ok(())
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn platform_registration_kills_running_instead_of_generic_orphan_retry(
        pool: PgPool,
    ) -> Result<(), sqlx::Error> {
        crate::jobs::setup_apalis(&pool).await?;
        sqlx::query(
            r#"
            INSERT INTO apalis.workers (
                id, worker_type, storage_name, layers, last_seen
            ) VALUES (
                'returning-worker', 'registration-test', 'old', '',
                NOW() - INTERVAL '2 hours'
            )
            "#,
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO apalis.jobs (
                job, id, job_type, status, attempts, run_at, lock_at, lock_by
            ) VALUES (
                decode('7b7d', 'hex'), 'interrupted-running',
                'registration-test', 'Running', 2,
                NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours',
                'returning-worker'
            )
            "#,
        )
        .execute(&pool)
        .await?;

        let config = Config::new("registration-test").set_buffer_size(1);
        let worker = WorkerContext::new::<()>("returning-worker");
        register_worker_and_reclaim(&pool, &config, &worker).await?;

        let row: (String, i32, Option<String>) = sqlx::query_as(
            "SELECT status, attempts, lock_by FROM apalis.jobs WHERE id = 'interrupted-running'",
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(row, ("Killed".to_owned(), 2, None));
        let action: String = sqlx::query_scalar(
            "SELECT action FROM background_job_reclaims WHERE job_id = 'interrupted-running'",
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(action, "startup_killed");
        Ok(())
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn registration_takes_over_own_process_and_stale_heartbeats_only(
        pool: PgPool,
    ) -> Result<(), sqlx::Error> {
        crate::jobs::setup_apalis(&pool).await?;
        let config = Config::new("registration-gate-test").set_buffer_size(1);
        let stale_after = Duration::from_secs(90);
        let worker = WorkerContext::new::<()>("gated-worker");

        // Another process with a fresh heartbeat keeps the id.
        sqlx::query(
            r#"
            INSERT INTO apalis.workers (id, worker_type, storage_name, layers, last_seen)
            VALUES ('gated-worker', 'registration-gate-test', 'TrezuSteadyPostgresStorage:other', '', NOW())
            "#,
        )
        .execute(&pool)
        .await?;
        let error = register_worker(&pool, &config, &worker, stale_after)
            .await
            .expect_err("a live worker in another process must keep its id");
        assert!(error.to_string().contains("WORKER_ALREADY_EXISTS"));

        // Once that heartbeat is stale the id is taken over and refreshed.
        sqlx::query(
            "UPDATE apalis.workers SET last_seen = NOW() - INTERVAL '10 minutes' WHERE id = 'gated-worker'",
        )
        .execute(&pool)
        .await?;
        register_worker(&pool, &config, &worker, stale_after).await?;
        let refreshed: bool = sqlx::query_scalar(
            "SELECT NOW() - last_seen < INTERVAL '5 seconds' FROM apalis.workers WHERE id = 'gated-worker'",
        )
        .fetch_one(&pool)
        .await?;
        assert!(refreshed, "takeover must refresh the heartbeat");

        // A rebuild inside this process does not wait for its own dead
        // predecessor's heartbeat to go stale.
        register_worker(&pool, &config, &worker, stale_after).await?;

        // Neither does the successor of a process that shut down cleanly.
        assert_eq!(release_worker_registrations(&pool).await?, 1);
        let storage_name: String =
            sqlx::query_scalar("SELECT storage_name FROM apalis.workers WHERE id = 'gated-worker'")
                .fetch_one(&pool)
                .await?;
        assert_eq!(storage_name, RELEASED_STORAGE_NAME);
        register_worker(&pool, &config, &worker, stale_after).await?;
        Ok(())
    }

    #[tokio::test]
    async fn heartbeat_survives_transient_failures_but_not_a_sustained_run() {
        let beats = stream::iter(vec![
            Err(sqlx::Error::PoolTimedOut),
            Err(sqlx::Error::PoolTimedOut),
            Ok(()),
            Err(sqlx::Error::PoolTimedOut),
            Err(sqlx::Error::PoolTimedOut),
            Err(sqlx::Error::PoolTimedOut),
        ]);
        let results: Vec<bool> = tolerate_missed_heartbeats(beats, "unit-test".to_owned())
            .map(|beat| beat.is_ok())
            .collect()
            .await;
        assert_eq!(results, [true, true, true, true, true, false]);

        // A missing registration is not transient and ends the worker at once.
        let beats = stream::iter(vec![
            Err(sqlx::Error::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "WORKER_DOES_NOT_EXIST",
            ))),
            Ok(()),
        ]);
        let first = tolerate_missed_heartbeats(beats, "unit-test".to_owned())
            .next()
            .await
            .expect("first beat");
        assert!(first.is_err());
    }

    #[tokio::test]
    async fn heartbeat_waits_for_the_current_attempt_to_register() {
        let pool = PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused")
            .expect("lazy pool needs no server");
        let spec = QueueSpec::cron("heartbeat-gate-test", 1, 1, Duration::from_secs(30));
        let storage = SteadyPostgresStorage::<()>::new(&pool, &spec, &JobWakeHub::default());
        let worker = WorkerContext::new::<()>("heartbeat-gate-test");

        // A predecessor attempt registered through a clone of this storage.
        storage.registered.send_replace(true);

        // The replacement's registration is delayed; its heartbeat must not
        // start on the predecessor's registration.
        let attempt = storage.clone().with_startup_delay(Duration::from_secs(60));
        let mut beats = attempt.heartbeat(&worker);
        let _poll = attempt.poll_compact_inner(&worker);
        assert!(
            tokio::time::timeout(Duration::from_millis(200), beats.next())
                .await
                .is_err(),
            "heartbeat must wait for this attempt's registration"
        );

        storage.registered.send_replace(true);
        tokio::time::timeout(Duration::from_secs(1), beats.next())
            .await
            .expect("heartbeat starts once registered")
            .expect("heartbeat stream is open")
            .expect("start signal is not an error");
    }

    #[tokio::test]
    async fn sink_drops_a_push_on_transient_database_error() {
        use futures::SinkExt;

        // No server and a short acquire timeout: every flush fails with a
        // transient pool/IO error, which must not surface to the pipe.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .acquire_timeout(Duration::from_millis(200))
            .connect_lazy("postgres://unused@127.0.0.1:1/unused")
            .expect("lazy pool needs no server");
        let spec = QueueSpec::cron("sink-transient-test", 1, 1, Duration::from_secs(30));
        let mut storage = SteadyPostgresStorage::<()>::new(&pool, &spec, &JobWakeHub::default());

        for _ in 0..2 {
            let task = PgTask::<()>::new(())
                .try_map(|args| JsonCodec::<CompactType>::encode(&args))
                .expect("encode unit task");
            storage
                .send(task)
                .await
                .expect("transient push failure must not end the worker");
        }
        assert!(!is_transient_db_error(&sqlx::Error::RowNotFound));
    }
}
