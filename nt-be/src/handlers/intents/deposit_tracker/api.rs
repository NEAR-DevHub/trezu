//! `GET /api/intents/deposit-tracker`: in-process deposits for the deposit
//! modal, scoped to the address the user is looking at (a chain for public
//! treasuries, a quote address for confidential addresses).
//!
//! Who may read what: chain scopes of a confidential treasury are member-only.
//! A one-time quote address is itself the capability, so its payer may read
//! it. The DAO's reusable quote address is permanent and handed to every
//! payer, so it is member-only for the full feed; anyone else sees only what
//! arrived from shortly before their page opened, without the origin
//! transaction hash (see [`TrackedDeposit::redacted`]).

use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Duration, Utc};
use near_api::AccountId;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::OptionalAuthUser;
use crate::handlers::intents::confidential::reusable_deposit::load_cached;
use crate::handlers::token::{TokenMetadata, fetch_tokens_with_fallback};

use super::store::{InProcessDeposit, find_quote_owner, load_recent_deposits_for_scope};

/// How far before their page open a non-member may look on a reusable
/// address: a transfer sent just before opening the link, nothing older.
const GUEST_MAX_LOOKBACK: Duration = Duration::minutes(15);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositTrackerQuery {
    pub account_id: AccountId,
    /// Public treasuries: the bridge chain id shown in the modal (e.g. `eth:8453`).
    pub chain: Option<String>,
    /// Confidential treasuries: the 1Click quote deposit address.
    pub quote_deposit_address: Option<String>,
    /// Only rows first seen at or after this instant (RFC 3339). Required
    /// from non-members reading a reusable address.
    pub since: Option<DateTime<Utc>>,
}

/// How much of the scope the caller may see.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Visibility {
    /// Members, public treasuries, and one-time quote payers.
    Full,
    /// Non-members on a reusable address: a short window, no hashes.
    GuestWindow,
}

/// The window a guest may read: their own stamp, but never further back
/// than `GUEST_MAX_LOOKBACK` before now.
fn guest_since(
    now: DateTime<Utc>,
    requested: Option<DateTime<Utc>>,
) -> Result<DateTime<Utc>, (StatusCode, String)> {
    let requested = requested.ok_or((
        StatusCode::BAD_REQUEST,
        "since is required for this address".to_string(),
    ))?;
    Ok(requested.max(now - GUEST_MAX_LOOKBACK))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedDeposit {
    pub id: i64,
    /// `detected | finalized | ledger_confirmed | failed`.
    pub status: &'static str,
    pub provider_status: String,
    pub chain: Option<String>,
    pub token_id: String,
    pub token_metadata: TokenMetadata,
    /// Decimal-adjusted amount, when the provider reported one.
    pub amount: Option<BigDecimal>,
    pub origin_tx_hash: Option<String>,
    pub detected_at: DateTime<Utc>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

impl TrackedDeposit {
    /// The guest view of a row: status, token, amount and timestamps, which
    /// a payer needs to see their own deposit land, and no transaction hash.
    /// `guest_row_exposes_a_fixed_field_set` pins the serialised key set, so
    /// a field added to the struct fails that test until this view decides
    /// whether to keep or clear it.
    fn redacted(mut self) -> Self {
        self.origin_tx_hash = None;
        self
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositTrackerResponse {
    pub deposits: Vec<TrackedDeposit>,
}

impl TrackedDeposit {
    fn from_row(row: InProcessDeposit, metadata: TokenMetadata) -> Self {
        Self {
            id: row.id,
            status: row.status.as_str(),
            provider_status: row.provider_status,
            chain: row.chain,
            token_id: row.token_id,
            token_metadata: metadata,
            amount: row.amount,
            origin_tx_hash: row.origin_tx_hash,
            detected_at: row.detected_at,
            finalized_at: row.finalized_at,
            updated_at: row.updated_at,
        }
    }
}

/// What a quote address is to the requesting treasury.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuoteScope {
    /// The treasury's own one-time quote (or an address no watch knows,
    /// which has no rows): the payer's capability.
    OneTime,
    /// The treasury's reusable address, by the watch's mark or the live set.
    Reusable,
    /// Handed out by a different treasury: no capability here.
    Foreign,
}

/// Classified from the watch the address was handed out with, looked up by
/// the address alone, so a caller cannot turn another treasury's reusable
/// address into a capability by naming the wrong account. A reusable
/// address stays one after the cached set is cleared or rotated: the watch
/// carries the mark for life; the live cache covers a set whose watch
/// never registered.
async fn quote_scope(
    pool: &sqlx::PgPool,
    dao_id: &str,
    quote: &str,
) -> Result<QuoteScope, sqlx::Error> {
    match find_quote_owner(pool, quote).await? {
        Some(owner) if owner.dao_id != dao_id => return Ok(QuoteScope::Foreign),
        Some(owner) if owner.reusable => return Ok(QuoteScope::Reusable),
        _ => {}
    }
    let cached = load_cached(pool, dao_id)
        .await?
        .is_some_and(|set| set.quote_deposit_address == quote);
    Ok(if cached {
        QuoteScope::Reusable
    } else {
        QuoteScope::OneTime
    })
}

pub async fn get_deposit_tracker(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(query): Query<DepositTrackerQuery>,
) -> Result<Json<DepositTrackerResponse>, (StatusCode, String)> {
    let quote = query
        .quote_deposit_address
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let chain = query
        .chain
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if quote.is_none() && chain.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "chain or quoteDepositAddress is required".to_string(),
        ));
    }
    let dao_id = query.account_id.as_str();
    let scope = match quote {
        Some(quote) => Some(
            quote_scope(&state.db_pool, dao_id, quote)
                .await
                .map_err(|e| {
                    tracing::error!("deposit tracker quote scope read failed: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to load deposit tracker state".to_string(),
                    )
                })?,
        ),
        None => None,
    };
    // A one-time quote address is the capability: share pages let the payer
    // (not a member) watch their own deposit, exactly like the confidential
    // deposit-address status endpoint. Chain-wide reads, the reusable
    // address, and another treasury's address go through the member check.
    let visibility = match scope {
        Some(QuoteScope::OneTime) => Visibility::Full,
        _ => match user
            .verify_member_if_confidential(&state.db_pool, &query.account_id)
            .await
        {
            Ok(_) => Visibility::Full,
            Err((StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN, _))
                if scope == Some(QuoteScope::Reusable) =>
            {
                Visibility::GuestWindow
            }
            Err(error) => return Err(error),
        },
    };
    let since = match visibility {
        Visibility::Full => query.since,
        Visibility::GuestWindow => Some(guest_since(Utc::now(), query.since)?),
    };

    let rows = load_recent_deposits_for_scope(&state.db_pool, dao_id, quote, chain, since)
        .await
        .map_err(|e| {
            tracing::error!("deposit tracker read failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load deposit tracker state".to_string(),
            )
        })?;

    let token_ids: Vec<String> = rows
        .iter()
        .map(|row| row.token_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let metadata = fetch_tokens_with_fallback(&state, &token_ids, false, false).await;

    let deposits = rows
        .into_iter()
        .map(|row| {
            let token_metadata = metadata.get(&row.token_id).cloned().unwrap_or_else(|| {
                crate::handlers::public_history::public_list::fallback_metadata(&row.token_id)
            });
            let deposit = TrackedDeposit::from_row(row, token_metadata);
            match visibility {
                Visibility::Full => deposit,
                Visibility::GuestWindow => deposit.redacted(),
            }
        })
        .collect();

    Ok(Json(DepositTrackerResponse { deposits }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::intents::deposit_tracker::store::{
        ObservedDeposit, upsert_deposit, upsert_watch,
    };
    use crate::handlers::intents::deposit_tracker::{DepositStatus, WatchKind};
    use crate::utils::test_utils::build_test_state;
    use sqlx::PgPool;

    const DAO: &str = "rda.sputnik-dao.near";
    const OTHER_DAO: &str = "other.sputnik-dao.near";

    async fn tracker(
        pool: &PgPool,
        quote: &str,
        since: Option<DateTime<Utc>>,
    ) -> Result<DepositTrackerResponse, StatusCode> {
        tracker_for(pool, DAO, quote, since).await
    }

    async fn tracker_for(
        pool: &PgPool,
        dao: &str,
        quote: &str,
        since: Option<DateTime<Utc>>,
    ) -> Result<DepositTrackerResponse, StatusCode> {
        get_deposit_tracker(
            State(Arc::new(build_test_state(pool.clone()))),
            OptionalAuthUser(None),
            Query(DepositTrackerQuery {
                account_id: dao.parse().expect("dao id"),
                chain: None,
                quote_deposit_address: Some(quote.to_string()),
                since,
            }),
        )
        .await
        .map(|Json(response)| response)
        .map_err(|(status, _)| status)
    }

    async fn seed_watch(pool: &PgPool, quote: &str, reusable: bool) -> i64 {
        let now = Utc::now();
        upsert_watch(
            pool,
            DAO,
            WatchKind::Confidential,
            Some(quote),
            "sol:mainnet",
            Some("nep141:sol.omft.near"),
            reusable,
            now + Duration::minutes(10),
            now + Duration::minutes(120),
        )
        .await
        .expect("upsert watch");
        sqlx::query_scalar("SELECT id FROM deposit_watches WHERE quote_deposit_address = $1")
            .bind(quote)
            .fetch_one(pool)
            .await
            .expect("watch id")
    }

    /// The reusable address keeps its guest-only visibility after the cached
    /// set is gone (cleared as stale, or rotated to a new address): the
    /// watch it was handed out with carries the mark, not the cache.
    #[sqlx::test]
    async fn reusable_address_stays_guarded_without_the_cached_set(pool: PgPool) {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, is_confidential_account) \
             VALUES ($1, true, true)",
        )
        .bind(DAO)
        .execute(&pool)
        .await
        .expect("seed dao");
        let watch_id = seed_watch(&pool, "rda-quote", true).await;
        seed_watch(&pool, "one-time-quote", false).await;
        upsert_deposit(
            &pool,
            watch_id,
            DAO,
            WatchKind::Confidential,
            &ObservedDeposit {
                provider_deposit_key: "rda:old".to_string(),
                chain: Some("sol:mainnet".to_string()),
                origin_tx_hash: Some("sol-hash".to_string()),
                near_tx_hash: None,
                token_id: "nep141:sol.omft.near".to_string(),
                amount: Some(BigDecimal::from(5)),
                provider_status: "SUCCESS".to_string(),
                status: DepositStatus::Finalized,
            },
        )
        .await
        .expect("record payout");
        sqlx::query(
            "UPDATE in_process_deposits SET detected_at = NOW() - interval '2 hours' \
             WHERE provider_deposit_key = 'rda:old'",
        )
        .execute(&pool)
        .await
        .expect("age the payout");
        // No cached set for the DAO: `confidential_reusable_deposit` is NULL.

        assert_eq!(
            tracker(&pool, "rda-quote", None)
                .await
                .map(|r| r.deposits.len()),
            Err(StatusCode::BAD_REQUEST),
            "a guest on the reusable address needs a stamp"
        );
        let window = tracker(&pool, "rda-quote", Some(Utc::now() - Duration::hours(3)))
            .await
            .expect("guest window");
        assert!(
            window.deposits.is_empty(),
            "the old payout is outside the capped guest window"
        );
        let one_time = tracker(&pool, "one-time-quote", None)
            .await
            .expect("one-time quote is its own capability");
        assert!(one_time.deposits.is_empty());

        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, is_confidential_account) \
             VALUES ($1, true, true)",
        )
        .bind(OTHER_DAO)
        .execute(&pool)
        .await
        .expect("seed other dao");
        assert_eq!(
            tracker_for(&pool, OTHER_DAO, "rda-quote", Some(Utc::now()))
                .await
                .map(|r| r.deposits.len()),
            Err(StatusCode::UNAUTHORIZED),
            "another treasury's reusable address is no capability"
        );
    }

    /// The guest view is redacted by hand, so the shape it serialises is
    /// pinned here: a new field on `TrackedDeposit` must be added to this
    /// list on purpose, after deciding whether a non-member may see it.
    #[test]
    fn guest_row_exposes_a_fixed_field_set() {
        let now = Utc::now();
        let row = TrackedDeposit {
            id: 1,
            status: "finalized",
            provider_status: "SUCCESS".to_string(),
            chain: Some("eth:8453".to_string()),
            token_id: "nep141:usdc.omft.near".to_string(),
            token_metadata: crate::handlers::public_history::public_list::fallback_metadata(
                "nep141:usdc.omft.near",
            ),
            amount: Some(BigDecimal::from(1)),
            origin_tx_hash: Some("0xabc".to_string()),
            detected_at: now,
            finalized_at: Some(now),
            updated_at: now,
        }
        .redacted();
        let json = serde_json::to_value(&row).expect("serialises");
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "amount",
                "chain",
                "detectedAt",
                "finalizedAt",
                "id",
                "originTxHash",
                "providerStatus",
                "status",
                "tokenId",
                "tokenMetadata",
                "updatedAt",
            ]
        );
        assert!(json["originTxHash"].is_null());
    }

    #[test]
    fn guest_window_needs_a_stamp_and_is_capped() {
        let now = Utc::now();
        assert_eq!(
            guest_since(now, None).map_err(|(status, _)| status),
            Err(StatusCode::BAD_REQUEST)
        );
        let recent = now - Duration::minutes(5);
        assert_eq!(guest_since(now, Some(recent)), Ok(recent));
        let stale = now - Duration::hours(3);
        assert_eq!(guest_since(now, Some(stale)), Ok(now - GUEST_MAX_LOOKBACK));
    }
}
