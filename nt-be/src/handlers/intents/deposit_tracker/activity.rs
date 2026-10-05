//! Recent-activity adapter: in-process deposits rendered in the same
//! `EnrichedBalanceChange` shape as ledger rows so the frontend needs no
//! merge logic. Ids are negated so they never collide with gold ids.

use std::collections::HashMap;
use std::sync::Arc;

use bigdecimal::{BigDecimal, Zero};
use chrono::Utc;

use crate::AppState;
use crate::handlers::public_history::public_list::fallback_metadata;
use crate::handlers::token::{TokenMetadata, fetch_tokens_with_fallback};
use crate::routes::{BalanceChangesQuery, EnrichedBalanceChange};

use super::store::{InProcessDeposit, load_visible_deposits};

/// Selects which tracker rows a list request may show. Tracker rows only
/// make sense on the first page of an unfiltered or incoming-only feed.
pub struct InProcessActivityFilter<'a> {
    pub offset: i64,
    pub transaction_types: Option<&'a [String]>,
    pub token_ids: Option<&'a [String]>,
    pub exclude_token_ids: Option<&'a [String]>,
    pub tx_hash: Option<&'a str>,
    pub has_account_filters: bool,
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
        }
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
        let amount = self.amount.clone().unwrap_or_else(BigDecimal::zero);
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
        })
    }
}

/// In-process deposit rows for the top of a recent-activity page, newest
/// first. Empty when the request's page or filters exclude them.
/// `ledger_rows` are the ledger rows already on the page: a tracker row
/// whose NEAR hash is among them is served by the ledger, even if the
/// worker has not linked it yet.
pub async fn in_process_activity_rows(
    state: &Arc<AppState>,
    params: &BalanceChangesQuery,
    ledger_rows: &[EnrichedBalanceChange],
) -> Result<Vec<EnrichedBalanceChange>, sqlx::Error> {
    let filter = InProcessActivityFilter::from_query(params);
    if !filter.applies() {
        return Ok(Vec::new());
    }

    let ledger_hashes: std::collections::HashSet<&str> = ledger_rows
        .iter()
        .flat_map(|row| row.transaction_hashes.iter().map(String::as_str))
        .collect();
    let deposits: Vec<InProcessDeposit> =
        load_visible_deposits(&state.db_pool, params.account_id.as_str())
            .await?
            .into_iter()
            .filter(|deposit| filter.allows_token(&deposit.token_id))
            .filter(|deposit| {
                deposit
                    .near_tx_hash
                    .as_deref()
                    .is_none_or(|hash| !ledger_hashes.contains(hash))
            })
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
