//! Deposit tracker cron tick: claim due watches, poll the provider, update
//! in-process rows, hand finalized deposits to history ingestion, and retire
//! rows once the ledger carries them.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use futures::StreamExt;
use near_account_id::AccountIdRef;
use sqlx::PgPool;

use crate::AppState;
use crate::handlers::intents::bridge_tokens::chain_id_for_balance_asset;
use crate::handlers::intents::confidential::bronze::store::mark_confidential_history_activity_due;
use crate::handlers::intents::confidential::reusable_deposit::{
    REUSABLE_DEPOSIT_KEY_PREFIX, ReusableDepositAddresses, ReusableDepositResolver,
    ReusableWithdrawal, WITHDRAWALS_PAGE_LIMIT, WithdrawalsError, clear_cached, load_cached,
};
use crate::handlers::public_history::bronze::NearblocksPriority;
use crate::handlers::public_history::bronze::api::fetch_latest_indexed_block_height;
use crate::handlers::public_history::bronze::store::{PublicHistorySource, upsert_latest_demand};

use super::bridge::{BridgeDeposit, BridgeDepositsClient};
use super::store::{
    self, ACTIVE_DEPOSIT_MAX_AGE, DepositTransition, DepositWatch, InProcessDeposit,
    ObservedDeposit, WatchPollOutcome,
};
use super::{DepositStatus, WatchKind};

const WATCH_BATCH: i64 = 25;
const WATCH_CONCURRENCY: usize = 4;
/// Claimed watches become due again after this if the worker dies mid-poll.
const CLAIM_LEASE: Duration = Duration::seconds(60);

const ACTIVE_DEPOSIT_POLL: Duration = Duration::seconds(10);
const FAST_POLL: Duration = Duration::seconds(5);
const MEDIUM_POLL: Duration = Duration::seconds(30);
const SLOW_POLL: Duration = Duration::seconds(120);
/// Discovery slows from the fast cadence to the medium one for this long
/// after `fast_until`, then to the slow one until `discovery_until`.
const MEDIUM_WINDOW: Duration = Duration::minutes(20);

const ERROR_BACKOFF_BASE: Duration = Duration::seconds(30);
const ERROR_BACKOFF_MAX: Duration = Duration::minutes(10);

/// How long a settled deposit may wait for its ledger row before the tracker
/// stops re-filing refresh demands (the row stays visible as evidence).
const MAX_REFRESH_ATTEMPTS: i32 = 12;
const REFRESH_BACKOFF: [i64; 5] = [10, 30, 60, 120, 300];
/// The bridge can mint slightly before the tracker first sees the deposit.
pub(super) const LEDGER_MATCH_LOOKBACK: Duration = Duration::minutes(30);
/// A reusable-address payout can be listed hours after its history row was
/// created (the tracker may first see it late in a slow discovery tier).
const REUSABLE_LEDGER_MATCH_LOOKBACK: Duration = Duration::hours(6);
const REUSABLE_LEDGER_MATCH_LOOKAHEAD: Duration = Duration::hours(1);
/// Pages of payouts one reusable poll may read when every entry on a full
/// page is new: more arrivals than one page since the last poll (or, on the
/// first poll, since the watch was created).
const REUSABLE_MAX_PAGES: u32 = 5;

#[derive(Debug, Default, Clone)]
pub struct TrackerTickSummary {
    pub watches_claimed: usize,
    pub watches_failed: usize,
    pub watches_retired: usize,
    pub deposits_changed: usize,
}

impl std::fmt::Display for TrackerTickSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "claimed={} failed={} retired={} deposits_changed={}",
            self.watches_claimed, self.watches_failed, self.watches_retired, self.deposits_changed
        )
    }
}

#[derive(Debug, Default)]
struct PollResult {
    changed: usize,
    baseline_keys: Option<Vec<String>>,
}

#[derive(Debug, Default)]
struct WatchOutcome {
    changed: usize,
    baseline_keys: Option<Vec<String>>,
    error: Option<String>,
    next_poll_at: Option<DateTime<Utc>>,
}

pub struct DepositTrackerWorker<'a> {
    state: &'a Arc<AppState>,
}

impl<'a> DepositTrackerWorker<'a> {
    pub fn new(state: &'a Arc<AppState>) -> Self {
        Self { state }
    }

    fn pool(&self) -> &PgPool {
        &self.state.db_pool
    }

    pub async fn tick(&self) -> Result<TrackerTickSummary, sqlx::Error> {
        let watches = store::claim_due_watches(self.pool(), WATCH_BATCH, CLAIM_LEASE).await?;
        let mut summary = TrackerTickSummary {
            watches_claimed: watches.len(),
            ..Default::default()
        };

        let mut outcomes = futures::stream::iter(watches)
            .map(|watch| async move {
                let outcome = self.process_watch(&watch).await;
                (watch, outcome)
            })
            .buffer_unordered(WATCH_CONCURRENCY);

        while let Some((watch, outcome)) = outcomes.next().await {
            if let Some(error) = outcome.error.as_deref() {
                summary.watches_failed += 1;
                tracing::warn!(
                    watch_id = watch.id,
                    dao_id = %watch.dao_id,
                    kind = watch.kind.as_str(),
                    attempts = watch.attempts,
                    error,
                    "deposit tracker poll failed"
                );
            }
            if outcome.next_poll_at.is_none() {
                summary.watches_retired += 1;
            }
            summary.deposits_changed += outcome.changed;

            store::record_watch_poll(
                self.pool(),
                watch.id,
                WatchPollOutcome {
                    next_poll_at: outcome.next_poll_at,
                    error: outcome.error.as_deref(),
                    baseline_keys: outcome.baseline_keys.as_deref(),
                    discovery_until: watch.discovery_until,
                },
            )
            .await?;

            if outcome.changed > 0 {
                self.state
                    .publish_treasury_projection_updated(watch.dao_id.clone())
                    .await;
            }
        }

        Ok(summary)
    }

    async fn process_watch(&self, watch: &DepositWatch) -> WatchOutcome {
        let mut outcome = WatchOutcome::default();

        let poll = match watch.kind {
            WatchKind::Public => self.poll_public(watch).await,
            WatchKind::Confidential => match self.reusable_set(watch).await {
                Ok(set) => self.poll_reusable(watch, &set).await,
                Err(error) => Err(error),
            },
        };
        match poll {
            Ok(result) => {
                outcome.changed += result.changed;
                outcome.baseline_keys = result.baseline_keys;
            }
            Err(error) => outcome.error = Some(error),
        }

        let deposits = match store::load_watch_deposits(self.pool(), watch.id).await {
            Ok(deposits) => deposits,
            Err(error) => {
                outcome
                    .error
                    .get_or_insert_with(|| format!("load deposits: {error}"));
                Vec::new()
            }
        };

        match self.reconcile(watch, &deposits).await {
            Ok(changed) => outcome.changed += changed,
            Err(error) => {
                outcome
                    .error
                    .get_or_insert_with(|| format!("ledger reconcile: {error}"));
            }
        }

        let now = Utc::now();
        let has_active = deposits.iter().any(|deposit| deposit.is_active(now));
        outcome.next_poll_at = WatchSchedule {
            watch,
            now,
            has_active_deposit: has_active,
            errored: outcome.error.is_some(),
        }
        .next_poll_at();
        outcome
    }

    /// The DAO's cached reusable deposit set this watch polls. A watch whose
    /// set is not cached (cleared as stale, or rotated) waits for the next
    /// deposit request to re-resolve it.
    async fn reusable_set(&self, watch: &DepositWatch) -> Result<ReusableDepositAddresses, String> {
        let set = load_cached(self.pool(), &watch.dao_id)
            .await
            .map_err(|error| format!("load reusable deposit set: {error}"))?;
        match set {
            Some(set)
                if watch.quote_deposit_address.as_deref()
                    == Some(set.quote_deposit_address.as_str()) =>
            {
                Ok(set)
            }
            _ => Err("reusable deposit set is not cached".to_string()),
        }
    }

    /// Reusable address: every payout of the DAO's quote is one deposit.
    /// The first poll files what settled before the watch as its baseline;
    /// later polls observe only payouts outside it.
    async fn poll_reusable(
        &self,
        watch: &DepositWatch,
        set: &ReusableDepositAddresses,
    ) -> Result<PollResult, String> {
        let dao = AccountIdRef::new(&watch.dao_id).map_err(|e| e.to_string())?;
        let resolver = ReusableDepositResolver::new(self.state);
        let mut page = match resolver.withdrawals(dao, set).await {
            Ok(page) => page,
            // Forget the set so the next deposit request re-resolves it.
            Err(error @ WithdrawalsError::StaleSet(_)) => {
                clear_cached(self.pool(), &watch.dao_id)
                    .await
                    .map_err(|db| format!("clear reusable deposit set: {db}"))?;
                tracing::warn!(
                    dao_id = %watch.dao_id,
                    watch_id = watch.id,
                    "cleared the cached reusable deposit set: {error}"
                );
                return Err(error.to_string());
            }
            Err(error) => return Err(error.to_string()),
        };
        let known = store::load_watch_deposits(self.pool(), watch.id)
            .await
            .map_err(|error| format!("load deposits: {error}"))?;
        let known_status = |key: &str| {
            known
                .iter()
                .find(|deposit| deposit.provider_deposit_key == key)
                .map(|deposit| deposit.status)
        };

        // A full page holding nothing that bounds it may continue on the
        // next page: read on until a payout already seen (or, on the first
        // poll, one older than the watch) appears.
        let bounds = |withdrawal: &ReusableWithdrawal| {
            let key = withdrawal.provider_deposit_key();
            known_status(&key).is_some()
                || match watch.baseline_keys.as_deref() {
                    Some(baseline) => baseline.contains(&key),
                    None => withdrawal.timestamp < watch.created_at,
                }
        };
        let mut tail = page.withdrawals.as_slice();
        let mut page_no = 1;
        while tail.len() == WITHDRAWALS_PAGE_LIMIT as usize
            && !tail.iter().any(bounds)
            && page_no < REUSABLE_MAX_PAGES
        {
            page_no += 1;
            let next = resolver
                .withdrawals_page(dao, set, page_no)
                .await
                .map_err(|error| error.to_string())?;
            if next.withdrawals.is_empty() {
                break;
            }
            let start = page.withdrawals.len();
            page.withdrawals.extend(next.withdrawals);
            tail = &page.withdrawals[start..];
        }

        let mut result = PollResult::default();
        let candidates: Vec<&ReusableWithdrawal> = match watch.baseline_keys.as_deref() {
            None => {
                let is_history = |withdrawal: &ReusableWithdrawal| {
                    known_status(&withdrawal.provider_deposit_key()).is_none()
                        && withdrawal.timestamp < watch.created_at
                };
                result.baseline_keys = Some(
                    page.withdrawals
                        .iter()
                        .filter(|withdrawal| is_history(withdrawal))
                        .map(ReusableWithdrawal::provider_deposit_key)
                        .collect(),
                );
                page.withdrawals
                    .iter()
                    .filter(|withdrawal| !is_history(withdrawal))
                    .collect()
            }
            Some(baseline) => page
                .withdrawals
                .iter()
                .filter(|withdrawal| !baseline.contains(&withdrawal.provider_deposit_key()))
                .collect(),
        };

        for withdrawal in candidates {
            let key = withdrawal.provider_deposit_key();
            let known = known_status(&key);
            if known.is_some_and(DepositStatus::is_terminal) {
                continue;
            }
            let observed = ObservedDeposit {
                provider_deposit_key: key.clone(),
                chain: watch.chain.clone(),
                origin_tx_hash: None,
                near_tx_hash: withdrawal.payout_hash(),
                // 1Click does not name the credited token per payout; the
                // token the modal was opened for is the best available label.
                token_id: watch.token_id.clone().unwrap_or_else(|| page.asset.clone()),
                amount: withdrawal.amount(),
                provider_status: withdrawal.status.clone(),
                status: if withdrawal.is_success() {
                    DepositStatus::Finalized
                } else if withdrawal.is_failed() {
                    DepositStatus::Failed
                } else {
                    DepositStatus::Detected
                },
            };
            let transition = self
                .record_observation(watch, &observed, known)
                .await
                .map_err(|error| format!("record deposit {key}: {error}"))?;
            if transition.changed() {
                result.changed += 1;
            }
        }
        Ok(result)
    }

    async fn poll_public(&self, watch: &DepositWatch) -> Result<PollResult, String> {
        let client = BridgeDepositsClient::new(self.state);
        let page = client.recent_deposits(&watch.dao_id).await?;
        let deposits = &page.deposits;
        let known = store::load_watch_deposits(self.pool(), watch.id)
            .await
            .map_err(|error| format!("load deposits: {error}"))?;
        let known_status = |key: &str| {
            known
                .iter()
                .find(|deposit| deposit.provider_deposit_key == key)
                .map(|deposit| deposit.status)
        };

        let mut result = PollResult::default();
        let candidates: Vec<_> = match watch.baseline_keys.as_deref() {
            // First read: a settled deposit the bridge recorded before this
            // watch existed is history. One recorded after it (settled while
            // the first poll was failing), anything in flight, and anything
            // this watch already tracks in an earlier life is observed.
            None => {
                let is_history = |deposit: &BridgeDeposit| {
                    known_status(&deposit.key).is_none()
                        && deposit.status.tracker_status() != DepositStatus::Detected
                        && deposit
                            .created_at
                            .is_none_or(|recorded_at| recorded_at < watch.created_at)
                };
                result.baseline_keys = Some(
                    deposits
                        .iter()
                        .filter(|deposit| is_history(deposit))
                        .map(|deposit| deposit.key.clone())
                        .collect(),
                );
                deposits
                    .iter()
                    .filter(|deposit| !is_history(deposit))
                    .collect()
            }
            Some(baseline) => deposits
                .iter()
                .filter(|deposit| !baseline.iter().any(|key| key == &deposit.key))
                .collect(),
        };

        for deposit in candidates {
            let known = known_status(&deposit.key);
            // Settled rows are owned by the ledger now; the bridge keeps
            // listing them but there is nothing left to observe.
            if known.is_some_and(DepositStatus::is_terminal) {
                continue;
            }
            let transition = self
                .record_observation(watch, &deposit.observed(), known)
                .await
                .map_err(|error| format!("record deposit {}: {error}", deposit.key))?;
            if transition.changed() {
                result.changed += 1;
            }
        }

        // A tracked deposit still in flight that newer deposits pushed off
        // the first page keeps advancing from the pages behind it.
        if page.has_more {
            let seen: HashSet<&str> = deposits.iter().map(|d| d.key.as_str()).collect();
            let outstanding: Vec<String> = known
                .iter()
                .filter(|deposit| deposit.status == DepositStatus::Detected)
                .filter(|deposit| !seen.contains(deposit.provider_deposit_key.as_str()))
                .map(|deposit| deposit.provider_deposit_key.clone())
                .collect();
            if !outstanding.is_empty() {
                for deposit in client.lookup_deposits(&watch.dao_id, &outstanding).await? {
                    let transition = self
                        .record_observation(
                            watch,
                            &deposit.observed(),
                            Some(DepositStatus::Detected),
                        )
                        .await
                        .map_err(|error| format!("record deposit {}: {error}", deposit.key))?;
                    if transition.changed() {
                        result.changed += 1;
                    }
                }
            }
        }
        Ok(result)
    }

    /// Persist one observation. A deposit that just settled commits together
    /// with its history-refresh demand so a crash cannot lose the handoff.
    /// `known` is the row's current status when the caller has it, so the
    /// NearBlocks head is only fetched for an observation that can finalize.
    async fn record_observation(
        &self,
        watch: &DepositWatch,
        observed: &ObservedDeposit,
        known: Option<DepositStatus>,
    ) -> Result<DepositTransition, sqlx::Error> {
        let may_finalize = observed.status == DepositStatus::Finalized
            && watch.kind == WatchKind::Public
            && !matches!(
                known,
                Some(DepositStatus::Finalized | DepositStatus::LedgerConfirmed)
            );
        let trigger_block_height = if may_finalize {
            Some(self.nearblocks_head().await)
        } else {
            None
        };

        let mut tx = self.pool().begin().await?;
        let transition =
            store::upsert_deposit(&mut *tx, watch.id, &watch.dao_id, watch.kind, observed).await?;
        if transition.just_finalized() {
            match watch.kind {
                WatchKind::Public => {
                    upsert_latest_demand(
                        &mut *tx,
                        &watch.dao_id,
                        PublicHistorySource::NearblocksMt,
                        trigger_block_height.unwrap_or(0),
                        None,
                    )
                    .await?;
                }
                WatchKind::Confidential => {
                    mark_confidential_history_activity_due(&mut *tx, &watch.dao_id).await?;
                }
            }
            store::schedule_refresh(&mut *tx, transition.id, Utc::now() + refresh_backoff(0))
                .await?;
            tracing::info!(
                dao_id = %watch.dao_id,
                kind = watch.kind.as_str(),
                deposit_key = %observed.provider_deposit_key,
                "deposit settled by provider; history refresh demanded"
            );
        }
        tx.commit().await?;
        Ok(transition)
    }

    /// Link finalized rows to their ledger row, or re-demand ingestion while
    /// the ledger still lags the provider.
    async fn reconcile(
        &self,
        watch: &DepositWatch,
        deposits: &[InProcessDeposit],
    ) -> Result<usize, sqlx::Error> {
        let now = Utc::now();
        let mut changed = 0;
        for deposit in deposits
            .iter()
            .filter(|deposit| deposit.status == DepositStatus::Finalized)
        {
            let ledger = match watch.kind {
                WatchKind::Public => {
                    store::find_public_ledger_match(
                        self.pool(),
                        &deposit.dao_id,
                        deposit.near_tx_hash.as_deref(),
                        &deposit.token_id,
                        deposit.amount.as_ref(),
                        deposit.detected_at - LEDGER_MATCH_LOOKBACK,
                    )
                    .await?
                }
                WatchKind::Confidential
                    if deposit
                        .provider_deposit_key
                        .starts_with(REUSABLE_DEPOSIT_KEY_PREFIX) =>
                {
                    store::find_reusable_ledger_match(
                        self.pool(),
                        &deposit.dao_id,
                        watch.quote_deposit_address.as_deref().unwrap_or_default(),
                        deposit.amount.as_ref(),
                        deposit.detected_at - REUSABLE_LEDGER_MATCH_LOOKBACK,
                        deposit.detected_at + REUSABLE_LEDGER_MATCH_LOOKAHEAD,
                    )
                    .await?
                }
                WatchKind::Confidential => {
                    store::find_confidential_ledger_match(
                        self.pool(),
                        &deposit.dao_id,
                        &deposit.provider_deposit_key,
                    )
                    .await?
                }
            };

            if let Some(ledger) = ledger {
                let chain = ledger
                    .token_id
                    .as_deref()
                    .and_then(chain_id_for_balance_asset);
                store::confirm_ledger(self.pool(), deposit.id, &ledger, chain.as_deref()).await?;
                changed += 1;
                continue;
            }

            let refresh_due = deposit.next_refresh_at.is_none_or(|at| at <= now);
            if refresh_due && deposit.refresh_attempts < MAX_REFRESH_ATTEMPTS {
                self.demand_refresh(watch).await?;
                store::schedule_refresh(
                    self.pool(),
                    deposit.id,
                    now + refresh_backoff(deposit.refresh_attempts),
                )
                .await?;
            } else if refresh_due {
                tracing::warn!(
                    dao_id = %deposit.dao_id,
                    deposit_id = deposit.id,
                    attempts = deposit.refresh_attempts,
                    "settled deposit still has no ledger row after all refresh attempts"
                );
            }
        }
        Ok(changed)
    }

    async fn demand_refresh(&self, watch: &DepositWatch) -> Result<(), sqlx::Error> {
        match watch.kind {
            WatchKind::Public => {
                let head = self.nearblocks_head().await;
                upsert_latest_demand(
                    self.pool(),
                    &watch.dao_id,
                    PublicHistorySource::NearblocksMt,
                    head,
                    None,
                )
                .await
            }
            WatchKind::Confidential => {
                mark_confidential_history_activity_due(self.pool(), &watch.dao_id).await
            }
        }
    }

    /// Current NearBlocks indexed head. The latest refresh job defers while
    /// the provider head is below the trigger height; without a NEAR hash the
    /// head itself is the right trigger. Zero never defers.
    async fn nearblocks_head(&self) -> i64 {
        if self.state.env_vars.nearblocks_api_key.is_none() {
            return 0;
        }
        match fetch_latest_indexed_block_height(self.state, NearblocksPriority::Latest).await {
            Ok(height) => height,
            Err((status, message)) => {
                tracing::warn!(%status, message, "nearblocks head unavailable; demand filed at 0");
                0
            }
        }
    }
}

impl InProcessDeposit {
    /// Every poll re-upserts the row and bumps `updated_at`, so the age gate
    /// reads the last real transition instead; a deposit the provider keeps
    /// listing unchanged stops being "active" after the window.
    fn is_active(&self, now: DateTime<Utc>) -> bool {
        !self.status.is_terminal() && self.last_transition_at() > now - ACTIVE_DEPOSIT_MAX_AGE
    }
}

struct WatchSchedule<'a> {
    watch: &'a DepositWatch,
    now: DateTime<Utc>,
    has_active_deposit: bool,
    errored: bool,
}

impl WatchSchedule<'_> {
    /// `None` retires the watch.
    fn next_poll_at(&self) -> Option<DateTime<Utc>> {
        let delay = self.discovery_delay()?;
        let delay = if self.errored {
            delay.max(error_backoff(self.watch.attempts))
        } else {
            delay
        };
        Some(self.now + jitter(delay))
    }

    fn discovery_delay(&self) -> Option<Duration> {
        if self.has_active_deposit {
            return Some(ACTIVE_DEPOSIT_POLL);
        }
        if self.now < self.watch.fast_until {
            Some(FAST_POLL)
        } else if self.now < self.watch.fast_until + MEDIUM_WINDOW {
            Some(MEDIUM_POLL)
        } else if self.now < self.watch.discovery_until {
            Some(SLOW_POLL)
        } else {
            None
        }
    }
}

fn error_backoff(attempts: i32) -> Duration {
    let exponent = attempts.saturating_sub(1).clamp(0, 10) as u32;
    let scaled = ERROR_BACKOFF_BASE
        .num_seconds()
        .saturating_mul(1i64 << exponent);
    Duration::seconds(scaled.min(ERROR_BACKOFF_MAX.num_seconds()))
}

fn refresh_backoff(attempts: i32) -> Duration {
    let index = (attempts.max(0) as usize).min(REFRESH_BACKOFF.len() - 1);
    Duration::seconds(REFRESH_BACKOFF[index])
}

/// Add 0–20% so coalesced watches do not all fire on the same tick.
fn jitter(delay: Duration) -> Duration {
    let percent = rand::random_range(100..=120i64);
    Duration::milliseconds(delay.num_milliseconds().saturating_mul(percent) / 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(now: DateTime<Utc>, kind: WatchKind) -> DepositWatch {
        DepositWatch {
            id: 1,
            dao_id: "dao.sputnik-dao.near".to_string(),
            kind,
            quote_deposit_address: (kind == WatchKind::Confidential).then(|| "quote".to_string()),
            chain: Some("eth:8453".to_string()),
            token_id: None,
            fast_until: now + Duration::minutes(10),
            discovery_until: now + Duration::minutes(120),
            baseline_keys: None,
            attempts: 1,
            created_at: now,
        }
    }

    fn schedule_delay(
        watch: &DepositWatch,
        now: DateTime<Utc>,
        has_active: bool,
    ) -> Option<Duration> {
        WatchSchedule {
            watch,
            now,
            has_active_deposit: has_active,
            errored: false,
        }
        .discovery_delay()
    }

    #[test]
    fn discovery_tiers_follow_the_windows() {
        let start = Utc::now();
        let watch = watch(start, WatchKind::Public);
        assert_eq!(schedule_delay(&watch, start, false), Some(FAST_POLL));
        assert_eq!(
            schedule_delay(&watch, start + Duration::minutes(15), false),
            Some(MEDIUM_POLL)
        );
        assert_eq!(
            schedule_delay(&watch, start + Duration::minutes(60), false),
            Some(SLOW_POLL)
        );
        assert_eq!(
            schedule_delay(&watch, start + Duration::minutes(121), false),
            None
        );
    }

    #[test]
    fn active_deposit_outlives_discovery_window() {
        let start = Utc::now();
        let watch = watch(start, WatchKind::Public);
        assert_eq!(
            schedule_delay(&watch, start + Duration::hours(5), true),
            Some(ACTIVE_DEPOSIT_POLL)
        );
    }

    #[test]
    fn errors_back_off_but_never_below_the_tier() {
        let start = Utc::now();
        let mut watch = watch(start, WatchKind::Public);
        watch.attempts = 3;
        let next = WatchSchedule {
            watch: &watch,
            now: start,
            has_active_deposit: false,
            errored: true,
        }
        .next_poll_at()
        .expect("still discovering");
        let delay = next - start;
        assert!(delay >= Duration::seconds(120), "got {delay}");
        assert!(delay <= Duration::seconds(145), "got {delay}");
    }

    #[test]
    fn backoff_ladders_are_capped() {
        assert_eq!(error_backoff(0), Duration::seconds(30));
        assert_eq!(error_backoff(2), Duration::seconds(60));
        assert_eq!(error_backoff(20), ERROR_BACKOFF_MAX);
        assert_eq!(refresh_backoff(0), Duration::seconds(10));
        assert_eq!(refresh_backoff(9), Duration::seconds(300));
    }
}
