//! Deposit tracker cron tick: claim due watches, poll the provider, update
//! in-process rows, hand finalized deposits to history ingestion, and retire
//! rows once the ledger carries them.

use std::str::FromStr;
use std::sync::Arc;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Duration, Utc};
use futures::StreamExt;
use near_api::AccountId;
use sqlx::PgPool;

use crate::AppState;
use crate::handlers::intents::confidential::bronze::api::fetch_history;
use crate::handlers::intents::confidential::bronze::store::mark_confidential_history_activity_due;
use crate::handlers::intents::confidential::bronze::store::upsert_history_events;
use crate::handlers::intents::swap_status::{
    FullSwapStatusResponse, SwapStatus, fetch_public_swap_status,
};
use crate::handlers::public_history::bronze::NearblocksPriority;
use crate::handlers::public_history::bronze::api::fetch_latest_indexed_block_height;
use crate::handlers::public_history::bronze::store::{PublicHistorySource, upsert_latest_demand};

use super::bridge::BridgeDepositsClient;
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
            WatchKind::Confidential => self.poll_confidential(watch).await,
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
        let has_terminal = deposits.iter().any(|deposit| deposit.status.is_terminal());
        outcome.next_poll_at = WatchSchedule {
            watch,
            now,
            has_active_deposit: has_active,
            has_terminal_deposit: has_terminal,
            errored: outcome.error.is_some(),
        }
        .next_poll_at();
        outcome
    }

    async fn poll_public(&self, watch: &DepositWatch) -> Result<PollResult, String> {
        let deposits = BridgeDepositsClient::new(self.state)
            .recent_deposits(&watch.dao_id)
            .await?;
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
            // First read: everything already settled is history, not a new
            // deposit. In-flight deposits are tracked from here on.
            None => {
                result.baseline_keys = Some(
                    deposits
                        .iter()
                        .filter(|deposit| {
                            deposit.status.tracker_status() != DepositStatus::Detected
                        })
                        .map(|deposit| deposit.key.clone())
                        .collect(),
                );
                deposits
                    .iter()
                    .filter(|deposit| deposit.status.tracker_status() == DepositStatus::Detected)
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
        Ok(result)
    }

    async fn poll_confidential(&self, watch: &DepositWatch) -> Result<PollResult, String> {
        let quote_deposit_address = watch
            .quote_deposit_address
            .as_deref()
            .ok_or_else(|| "confidential watch without quote address".to_string())?;
        let account_id = AccountId::from_str(&watch.dao_id).map_err(|e| e.to_string())?;

        let page = fetch_history(
            self.state,
            &account_id,
            5,
            None,
            None,
            Some(quote_deposit_address),
        )
        .await
        .map_err(|(status, message)| format!("{status}: {message}"))?;

        let mut result = PollResult::default();
        let Some(newest) = page.items.first() else {
            return Ok(result);
        };

        // Same dedup path as the account-level ingest, so the eventual gold
        // projection has its bronze row regardless of which poller saw it first.
        upsert_history_events(self.pool(), &watch.dao_id, &page.items)
            .await
            .map_err(|error| format!("bronze upsert: {error}"))?;

        let Some(status) = confidential_tracker_status(&newest.item.status) else {
            return Ok(result);
        };
        // History reports the quote nominal as the amount until settlement.
        // `/v0/status` (the quote was minted with the app key) carries the
        // deposit 1Click actually saw; without it the amount stays unknown.
        let amount = match fetch_public_swap_status(
            &self.state.http_client,
            &self.state.env_vars.confidential_api_url,
            self.state.env_vars.oneclick_jwt_token.as_ref(),
            quote_deposit_address,
            newest.item.deposit_memo.as_deref(),
        )
        .await
        {
            Ok(full) => confidential_amount(&full),
            Err((_, message)) => {
                tracing::debug!(
                    dao_id = %watch.dao_id,
                    quote_deposit_address,
                    error = %message,
                    "deposit tracker: 1Click status unavailable, amount unknown"
                );
                None
            }
        };
        let observed = ObservedDeposit {
            provider_deposit_key: quote_deposit_address.to_string(),
            chain: watch.chain.clone(),
            origin_tx_hash: newest.item.first_quote_tx_hash().map(str::to_string),
            near_tx_hash: None,
            token_id: newest.item.destination_asset.clone(),
            amount,
            provider_status: newest.item.status.clone(),
            status,
        };
        let transition = self
            .record_observation(watch, &observed, None)
            .await
            .map_err(|error| format!("record deposit {quote_deposit_address}: {error}"))?;
        if transition.changed() {
            result.changed += 1;
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
            let ledger_event_id = match watch.kind {
                WatchKind::Public => match deposit.amount.as_ref() {
                    Some(amount) => {
                        store::find_public_ledger_match(
                            self.pool(),
                            &deposit.dao_id,
                            deposit.near_tx_hash.as_deref(),
                            &deposit.token_id,
                            amount,
                            deposit.detected_at - LEDGER_MATCH_LOOKBACK,
                        )
                        .await?
                    }
                    None => None,
                },
                WatchKind::Confidential => {
                    store::find_confidential_ledger_match(
                        self.pool(),
                        &deposit.dao_id,
                        &deposit.provider_deposit_key,
                    )
                    .await?
                }
            };

            if let Some(ledger_event_id) = ledger_event_id {
                store::confirm_ledger(self.pool(), deposit.id, ledger_event_id).await?;
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
    fn is_active(&self, now: DateTime<Utc>) -> bool {
        !self.status.is_terminal() && self.updated_at > now - ACTIVE_DEPOSIT_MAX_AGE
    }
}

struct WatchSchedule<'a> {
    watch: &'a DepositWatch,
    now: DateTime<Utc>,
    has_active_deposit: bool,
    has_terminal_deposit: bool,
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
        // A one-time quote is spent once its deposit reached a terminal state.
        if self.watch.kind == WatchKind::Confidential && self.has_terminal_deposit {
            return None;
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

/// 1Click status → tracker state. `PENDING_DEPOSIT` is "address unused",
/// not deposit evidence, so it yields no row. Unknown statuses are treated
/// as in-progress rather than terminal.
fn confidential_tracker_status(raw: &str) -> Option<DepositStatus> {
    match raw.trim().to_ascii_uppercase().as_str() {
        "PENDING_DEPOSIT" => None,
        "SUCCESS" => Some(DepositStatus::Finalized),
        "REFUNDED" | "FAILED" | "INCOMPLETE_DEPOSIT" => Some(DepositStatus::Failed),
        _ => Some(DepositStatus::Detected),
    }
}

/// Credited amount once settled, otherwise the deposit 1Click has observed
/// on chain. Never the quote nominal: that is only what the address was
/// minted with, not what the user sent.
fn confidential_amount(full: &FullSwapStatusResponse) -> Option<BigDecimal> {
    let details = full.swap_details.as_ref()?;
    let text = if matches!(full.status, SwapStatus::Success) {
        details
            .amount_out_formatted
            .as_deref()
            .or(details.deposited_amount_formatted.as_deref())
    } else {
        details.deposited_amount_formatted.as_deref()
    };
    text.and_then(|text| BigDecimal::from_str(text.trim()).ok())
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
        has_terminal: bool,
    ) -> Option<Duration> {
        WatchSchedule {
            watch,
            now,
            has_active_deposit: has_active,
            has_terminal_deposit: has_terminal,
            errored: false,
        }
        .discovery_delay()
    }

    #[test]
    fn discovery_tiers_follow_the_windows() {
        let start = Utc::now();
        let watch = watch(start, WatchKind::Public);
        assert_eq!(schedule_delay(&watch, start, false, false), Some(FAST_POLL));
        assert_eq!(
            schedule_delay(&watch, start + Duration::minutes(15), false, false),
            Some(MEDIUM_POLL)
        );
        assert_eq!(
            schedule_delay(&watch, start + Duration::minutes(60), false, false),
            Some(SLOW_POLL)
        );
        assert_eq!(
            schedule_delay(&watch, start + Duration::minutes(121), false, false),
            None
        );
    }

    #[test]
    fn active_deposit_outlives_discovery_window() {
        let start = Utc::now();
        let watch = watch(start, WatchKind::Public);
        assert_eq!(
            schedule_delay(&watch, start + Duration::hours(5), true, false),
            Some(ACTIVE_DEPOSIT_POLL)
        );
    }

    #[test]
    fn confidential_watch_retires_once_its_deposit_is_terminal() {
        let start = Utc::now();
        let confidential = watch(start, WatchKind::Confidential);
        assert_eq!(schedule_delay(&confidential, start, false, true), None);
        let public = watch(start, WatchKind::Public);
        assert_eq!(schedule_delay(&public, start, false, true), Some(FAST_POLL));
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
            has_terminal_deposit: false,
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

    fn status_response(status: SwapStatus, details: serde_json::Value) -> FullSwapStatusResponse {
        serde_json::from_value(serde_json::json!({
            "status": status,
            "updatedAt": "2026-10-08T00:00:00Z",
            "swapDetails": details,
        }))
        .expect("status response parses")
    }

    #[test]
    fn confidential_amount_is_the_observed_deposit_never_the_quote_nominal() {
        // Deposit known but not settled: the on-chain amount, not the quote.
        let processing = status_response(
            SwapStatus::Processing,
            serde_json::json!({
                "depositedAmountFormatted": "5",
                "amountInFormatted": "0.15",
                "amountOutFormatted": "0.15"
            }),
        );
        assert_eq!(confidential_amount(&processing), Some(BigDecimal::from(5)));

        // Nothing observed yet: unknown, not the nominal.
        let waiting = status_response(
            SwapStatus::KnownDepositTx,
            serde_json::json!({ "amountInFormatted": "0.15", "amountOutFormatted": "0.15" }),
        );
        assert_eq!(confidential_amount(&waiting), None);

        // Settled: the credited amount.
        let settled = status_response(
            SwapStatus::Success,
            serde_json::json!({ "depositedAmountFormatted": "5", "amountOutFormatted": "4.99" }),
        );
        assert_eq!(
            confidential_amount(&settled),
            Some(BigDecimal::from_str("4.99").unwrap())
        );
        let no_details: FullSwapStatusResponse = serde_json::from_value(serde_json::json!({
            "status": "PENDING_DEPOSIT",
            "updatedAt": "2026-10-08T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(confidential_amount(&no_details), None);
    }

    #[test]
    fn confidential_statuses_map_to_tracker_states() {
        assert_eq!(confidential_tracker_status("PENDING_DEPOSIT"), None);
        assert_eq!(
            confidential_tracker_status("KNOWN_DEPOSIT_TX"),
            Some(DepositStatus::Detected)
        );
        assert_eq!(
            confidential_tracker_status("processing"),
            Some(DepositStatus::Detected)
        );
        assert_eq!(
            confidential_tracker_status("SUCCESS"),
            Some(DepositStatus::Finalized)
        );
        assert_eq!(
            confidential_tracker_status("REFUNDED"),
            Some(DepositStatus::Failed)
        );
        assert_eq!(
            confidential_tracker_status("BRAND_NEW"),
            Some(DepositStatus::Detected)
        );
    }
}
