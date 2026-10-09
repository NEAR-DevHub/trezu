//! Recent-activity adapter: in-process deposits rendered in the same
//! `EnrichedBalanceChange` shape as ledger rows so the frontend needs no
//! merge logic. Ids are negated so they never collide with gold ids.

use std::collections::HashMap;
use std::sync::Arc;

use bigdecimal::{BigDecimal, Zero};
use chrono::{DateTime, Utc};

use crate::AppState;
use crate::handlers::public_history::public_list::fallback_metadata;
use crate::handlers::token::{TokenMetadata, fetch_tokens_with_fallback};
use crate::routes::{BalanceChangesQuery, EnrichedBalanceChange};

use super::store::{InProcessDeposit, load_visible_deposits};
use super::worker::LEDGER_MATCH_LOOKBACK;

/// Selects which tracker rows a list request may show. Tracker rows only
/// make sense on the first page of an unfiltered or incoming-only feed.
pub struct InProcessActivityFilter<'a> {
    pub offset: i64,
    pub transaction_types: Option<&'a [String]>,
    pub token_ids: Option<&'a [String]>,
    pub exclude_token_ids: Option<&'a [String]>,
    pub tx_hash: Option<&'a str>,
    pub has_account_filters: bool,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
}

fn parse_time(raw: Option<&String>) -> Option<DateTime<Utc>> {
    raw.and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|at| at.with_timezone(&Utc))
}

impl<'a> InProcessActivityFilter<'a> {
    pub fn from_query(params: &'a BalanceChangesQuery) -> Self {
        Self {
            offset: params.offset.unwrap_or(0),
            transaction_types: params.transaction_types.as_deref(),
            token_ids: params.token_ids.as_deref(),
            exclude_token_ids: params.exclude_token_ids.as_deref(),
            tx_hash: params.tx_hash.as_deref().filter(|s| !s.is_empty()),
            has_account_filters: [
                &params.from_accounts,
                &params.from_accounts_not,
                &params.to_accounts,
                &params.to_accounts_not,
            ]
            .iter()
            .any(|filter| filter.as_ref().is_some_and(|v| !v.is_empty())),
            start_time: parse_time(params.start_time.as_ref()),
            end_time: parse_time(params.end_time.as_ref()),
        }
    }

    /// Same window the ledger query applies to `block_time`.
    fn allows_time(&self, detected_at: DateTime<Utc>) -> bool {
        self.start_time.is_none_or(|start| detected_at >= start)
            && self.end_time.is_none_or(|end| detected_at <= end)
    }

    fn applies(&self) -> bool {
        if self.offset != 0 || self.tx_hash.is_some() || self.has_account_filters {
            return false;
        }
        match self.transaction_types {
            None => true,
            Some(types) => types.is_empty() || types.iter().any(|t| t == "incoming"),
        }
    }

    fn allows_token(&self, token_id: &str) -> bool {
        if let Some(allowed) = self.token_ids.filter(|ids| !ids.is_empty())
            && !allowed.iter().any(|id| id == token_id)
        {
            return false;
        }
        if let Some(excluded) = self.exclude_token_ids.filter(|ids| !ids.is_empty())
            && excluded.iter().any(|id| id == token_id)
        {
            return false;
        }
        true
    }
}

impl InProcessDeposit {
    fn action_kind(&self) -> Option<String> {
        self.status
            .activity_suffix()
            .map(|suffix| format!("{}:{suffix}", self.kind.action_kind_prefix()))
    }

    fn to_enriched(
        &self,
        metadata: &HashMap<String, TokenMetadata>,
    ) -> Option<EnrichedBalanceChange> {
        let action_kind = self.action_kind()?;
        // Without an amount the feed would label the row a zero "Transaction";
        // the modal panel still shows it as detected.
        let amount = self.amount.clone()?;
        Some(EnrichedBalanceChange {
            id: -self.id,
            account_id: self.dao_id.clone(),
            block_height: 0,
            block_time: self.detected_at,
            token_id: self.token_id.clone(),
            receipt_id: Vec::new(),
            transaction_hashes: Vec::new(),
            counterparty: None,
            signer_id: None,
            receiver_id: Some(self.dao_id.clone()),
            amount,
            balance_before: BigDecimal::zero(),
            balance_after: BigDecimal::zero(),
            created_at: self.detected_at,
            token_metadata: Some(
                metadata
                    .get(&self.token_id)
                    .cloned()
                    .unwrap_or_else(|| fallback_metadata(&self.token_id)),
            ),
            swap: None,
            action_kind: Some(action_kind),
            method_name: None,
            actions: None,
            usd_value: None,
            proposal_id: None,
            quote_deposit_address: None,
            notes: None,
        })
    }
}

/// Whether a ledger row already on the page represents this tracker row,
/// even though the worker has not linked them yet. Mirrors
/// `find_public_ledger_match`: the NEAR mint hash when the provider gave
/// one (PoA, HOT), otherwise the same token and amount inside the lookback
/// window (Omni rows arrive with an empty `mint_tx_hash`).
///
/// Accepted imprecision for the hashless path: Omni has no identity on
/// either side (the bridge omits the mint hash, the NEAR mint carries no
/// origin hash), so two equal deposits inside the window, or an unrelated
/// transfer of the same token and amount, can hide a Processing row until
/// its own mint lands. Cosmetic and bounded by the mint delay; the ledger
/// is never affected.
fn served_by_ledger(deposit: &InProcessDeposit, ledger_rows: &[EnrichedBalanceChange]) -> bool {
    if let Some(hash) = deposit.near_tx_hash.as_deref() {
        return ledger_rows
            .iter()
            .any(|row| row.transaction_hashes.iter().any(|h| h == hash));
    }
    let Some(amount) = deposit.amount.as_ref() else {
        return false;
    };
    let not_before = deposit.detected_at - LEDGER_MATCH_LOOKBACK;
    ledger_rows.iter().any(|row| {
        row.id > 0
            && row.token_id == deposit.token_id
            && row.amount == *amount
            && row.block_time >= not_before
    })
}

/// In-process deposit rows for the top of a recent-activity page, newest
/// first. Empty when the request's page or filters exclude them.
/// `ledger_rows` are the ledger rows already on the page: a tracker row
/// the ledger already serves is dropped so "Processing" and "Completed"
/// never show side by side.
pub async fn in_process_activity_rows(
    state: &Arc<AppState>,
    params: &BalanceChangesQuery,
    ledger_rows: &[EnrichedBalanceChange],
) -> Result<Vec<EnrichedBalanceChange>, sqlx::Error> {
    let filter = InProcessActivityFilter::from_query(params);
    if !filter.applies() {
        return Ok(Vec::new());
    }

    let deposits: Vec<InProcessDeposit> =
        load_visible_deposits(&state.db_pool, params.account_id.as_str())
            .await?
            .into_iter()
            .filter(|deposit| filter.allows_token(&deposit.token_id))
            .filter(|deposit| filter.allows_time(deposit.detected_at))
            .filter(|deposit| !served_by_ledger(deposit, ledger_rows))
            .collect();
    if deposits.is_empty() {
        return Ok(Vec::new());
    }

    let token_ids: Vec<String> = deposits
        .iter()
        .map(|deposit| deposit.token_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let metadata = fetch_tokens_with_fallback(
        state,
        &token_ids,
        params.include_chain_metadata.unwrap_or(false),
        false,
    )
    .await;

    let now = Utc::now();
    Ok(deposits
        .iter()
        .filter(|deposit| deposit.detected_at <= now)
        .filter_map(|deposit| deposit.to_enriched(&metadata))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::intents::deposit_tracker::{DepositStatus, WatchKind};

    fn deposit(kind: WatchKind, status: DepositStatus) -> InProcessDeposit {
        InProcessDeposit {
            id: 7,
            watch_id: 1,
            dao_id: "dao.sputnik-dao.near".to_string(),
            kind,
            provider_deposit_key: "k".to_string(),
            chain: Some("eth:8453".to_string()),
            origin_tx_hash: Some("0xabc".to_string()),
            near_tx_hash: None,
            token_id: "intents.near:nep141:usdc.omft.near".to_string(),
            amount: Some(BigDecimal::from(100)),
            provider_status: "PENDING".to_string(),
            status,
            detected_at: Utc::now(),
            finalized_at: None,
            ledger_event_id: None,
            refresh_attempts: 0,
            next_refresh_at: None,
            updated_at: Utc::now(),
        }
    }

    fn ledger_row(
        id: i64,
        token_id: &str,
        amount: i64,
        hashes: &[&str],
        block_time: chrono::DateTime<Utc>,
    ) -> EnrichedBalanceChange {
        EnrichedBalanceChange {
            id,
            account_id: "dao.sputnik-dao.near".to_string(),
            block_height: 1,
            block_time,
            token_id: token_id.to_string(),
            receipt_id: Vec::new(),
            transaction_hashes: hashes.iter().map(|h| h.to_string()).collect(),
            counterparty: None,
            signer_id: None,
            receiver_id: None,
            amount: BigDecimal::from(amount),
            balance_before: BigDecimal::zero(),
            balance_after: BigDecimal::zero(),
            created_at: block_time,
            token_metadata: None,
            swap: None,
            action_kind: None,
            method_name: None,
            actions: None,
            usd_value: None,
            proposal_id: None,
            quote_deposit_address: None,
            notes: None,
        }
    }

    #[test]
    fn hashed_row_is_served_by_matching_ledger_hash_only() {
        let mut tracked = deposit(WatchKind::Public, DepositStatus::Finalized);
        tracked.near_tx_hash = Some("mint".to_string());
        let token = tracked.token_id.clone();
        let now = Utc::now();
        // Same token + amount but a different hash: not the same deposit.
        assert!(!served_by_ledger(
            &tracked,
            &[ledger_row(1, &token, 100, &["other"], now)]
        ));
        assert!(served_by_ledger(
            &tracked,
            &[ledger_row(1, &token, 100, &["other", "mint"], now)]
        ));
    }

    #[test]
    fn hashless_row_is_served_by_token_amount_inside_lookback() {
        let tracked = deposit(WatchKind::Public, DepositStatus::Finalized);
        let token = tracked.token_id.clone();
        let now = Utc::now();
        assert!(served_by_ledger(
            &tracked,
            &[ledger_row(1, &token, 100, &["mint"], now)]
        ));
        // Wrong amount, wrong token, too old, or another tracker row: no.
        assert!(!served_by_ledger(
            &tracked,
            &[ledger_row(1, &token, 99, &["mint"], now)]
        ));
        assert!(!served_by_ledger(
            &tracked,
            &[ledger_row(1, "intents.near:nep141:x", 100, &["mint"], now)]
        ));
        assert!(!served_by_ledger(
            &tracked,
            &[ledger_row(
                1,
                &token,
                100,
                &["mint"],
                now - LEDGER_MATCH_LOOKBACK - chrono::Duration::minutes(1)
            )]
        ));
        assert!(!served_by_ledger(
            &tracked,
            &[ledger_row(-9, &token, 100, &[], now)]
        ));
    }

    #[test]
    fn date_range_applies_to_detection_time() {
        let at = |text: &str| {
            DateTime::parse_from_rfc3339(text)
                .unwrap()
                .with_timezone(&Utc)
        };
        let september = InProcessActivityFilter {
            offset: 0,
            transaction_types: None,
            token_ids: None,
            exclude_token_ids: None,
            tx_hash: None,
            has_account_filters: false,
            start_time: parse_time(Some(&"2026-09-01T00:00:00Z".to_string())),
            end_time: parse_time(Some(&"2026-09-30T23:59:59Z".to_string())),
        };
        assert!(september.allows_time(at("2026-09-15T12:00:00Z")));
        assert!(!september.allows_time(at("2026-10-08T12:00:00Z")));
        assert!(!september.allows_time(at("2026-08-31T23:59:59Z")));

        let open = InProcessActivityFilter {
            start_time: parse_time(None),
            end_time: parse_time(Some(&"not a date".to_string())),
            ..september
        };
        assert!(open.allows_time(at("2026-10-08T12:00:00Z")));
    }

    #[test]
    fn rows_without_an_amount_stay_out_of_the_feed() {
        let mut tracked = deposit(WatchKind::Confidential, DepositStatus::Detected);
        tracked.amount = None;
        assert!(tracked.to_enriched(&HashMap::new()).is_none());
    }

    #[test]
    fn rows_carry_negative_ids_and_status_suffixed_action_kinds() {
        let row = deposit(WatchKind::Public, DepositStatus::Detected)
            .to_enriched(&HashMap::new())
            .expect("visible");
        assert_eq!(row.id, -7);
        assert_eq!(row.action_kind.as_deref(), Some("PublicDeposit:pending"));
        assert_eq!(row.amount, BigDecimal::from(100));
        assert!(
            row.token_metadata.is_some(),
            "unknown tokens still render through the fallback metadata"
        );

        let finalized = deposit(WatchKind::Confidential, DepositStatus::Finalized)
            .to_enriched(&HashMap::new())
            .expect("visible");
        assert_eq!(
            finalized.action_kind.as_deref(),
            Some("ConfidentialDeposit:pending")
        );

        let failed = deposit(WatchKind::Public, DepositStatus::Failed)
            .to_enriched(&HashMap::new())
            .expect("visible");
        assert_eq!(failed.action_kind.as_deref(), Some("PublicDeposit:failed"));

        assert!(
            deposit(WatchKind::Public, DepositStatus::LedgerConfirmed)
                .to_enriched(&HashMap::new())
                .is_none(),
            "confirmed rows are served by the ledger"
        );
    }

    #[test]
    fn filter_only_applies_to_first_page_of_incoming_or_all() {
        let base = InProcessActivityFilter {
            offset: 0,
            transaction_types: None,
            token_ids: None,
            exclude_token_ids: None,
            tx_hash: None,
            has_account_filters: false,
            start_time: None,
            end_time: None,
        };
        assert!(base.applies());

        let incoming = vec!["incoming".to_string()];
        assert!(
            InProcessActivityFilter {
                transaction_types: Some(&incoming),
                ..base
            }
            .applies()
        );
        let outgoing = vec!["outgoing".to_string()];
        assert!(
            !InProcessActivityFilter {
                transaction_types: Some(&outgoing),
                ..base
            }
            .applies()
        );
        assert!(!InProcessActivityFilter { offset: 10, ..base }.applies());
        assert!(
            !InProcessActivityFilter {
                tx_hash: Some("abc"),
                ..base
            }
            .applies()
        );
        assert!(
            !InProcessActivityFilter {
                has_account_filters: true,
                ..base
            }
            .applies()
        );

        let allowed = vec!["intents.near:nep141:usdc.omft.near".to_string()];
        let with_tokens = InProcessActivityFilter {
            token_ids: Some(&allowed),
            ..base
        };
        assert!(with_tokens.allows_token("intents.near:nep141:usdc.omft.near"));
        assert!(!with_tokens.allows_token("wrap.near"));
        let with_excluded = InProcessActivityFilter {
            exclude_token_ids: Some(&allowed),
            ..base
        };
        assert!(!with_excluded.allows_token("intents.near:nep141:usdc.omft.near"));
    }
}
