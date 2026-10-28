//! Reusable 1Click deposit address set for a confidential treasury.
//!
//! 1Click models a reusable address as one long-lived `ANY_INPUT` quote per
//! account: its `depositAddress` is the monitoring address and
//! `chainDepositAddresses` lists one funding address per blockchain, all
//! crediting the account's confidential balance. The set is discovered (or
//! created once) with the DAO JWT and cached on `monitored_accounts`, so the
//! deposit modal and share pages serve it without a 1Click round trip.
//! Mirrors near.com `features/deposit/server/rdaApi.ts`.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use near_account_id::AccountIdRef;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;

use crate::AppState;
use crate::handlers::intents::bridge_tokens::fallback_chain_id_for_name;
use crate::handlers::intents::confidential::refresh_dao_jwt;
use crate::handlers::intents::confidential::types::accounts_equal;
use crate::handlers::intents::quote::send_oneclick_request;
use crate::observability::sanitize_sensitive_text;

/// 1Click requires this fixed deadline for reusable quotes; never derive it
/// from the current time.
pub const REUSABLE_QUOTE_DEADLINE: &str = "2038-01-01T00:00:00.000Z";
const ANY_INPUT_ORIGIN_ASSET: &str = "1cs_v1:any";
const ANY_INPUT_DESTINATION_ASSET: &str = "1cs_v1:original";
const CONFIDENTIALITY: &str = "basic";
const SLIPPAGE_TOLERANCE_BPS: u32 = 50;
const QUOTES_PATH: &str = "/v0/quotes";
const MAX_QUOTE_PAGES: usize = 50;

/// One funding address of the set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChainDepositAddress {
    /// 1Click blockchain code (`eth`, `base`, `arb`, `btc`, `sol`, `near`, …).
    pub blockchain: String,
    pub address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

impl ChainDepositAddress {
    /// Bridge chain id the deposit modal selects by (`eth:8453`, `btc:mainnet`).
    pub fn bridge_chain_id(&self) -> String {
        fallback_chain_id_for_name(&self.blockchain)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReusableDepositAddresses {
    /// The quote's intents account: what status and withdrawals are read by.
    pub quote_deposit_address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_deposit_memo: Option<String>,
    pub chain_deposit_addresses: Vec<ChainDepositAddress>,
    /// 1Click quote id from the listing, when discovered rather than created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    pub resolved_at: DateTime<Utc>,
}

impl ReusableDepositAddresses {
    pub fn address_for_chain(&self, bridge_chain_id: &str) -> Option<&ChainDepositAddress> {
        self.chain_deposit_addresses
            .iter()
            .find(|entry| entry.bridge_chain_id() == bridge_chain_id)
    }

    /// Whether `address` is the monitoring address or one of the funding
    /// addresses of this set.
    pub fn owns_address(&self, address: &str) -> bool {
        self.quote_deposit_address == address
            || self
                .chain_deposit_addresses
                .iter()
                .any(|entry| entry.address == address)
    }

    fn from_quote(
        quote: &Value,
        quote_id: Option<String>,
        correlation_id: Option<String>,
    ) -> Result<Self, String> {
        let quote_deposit_address = quote
            .get("depositAddress")
            .and_then(Value::as_str)
            .filter(|address| !address.is_empty())
            .ok_or("reusable quote has no depositAddress")?
            .to_string();
        let quote_deposit_memo = quote
            .get("depositMemo")
            .and_then(Value::as_str)
            .filter(|memo| !memo.is_empty())
            .map(str::to_string);
        let chain_deposit_addresses: Vec<ChainDepositAddress> = quote
            .get("chainDepositAddresses")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| format!("invalid chainDepositAddresses: {e}"))?
            .unwrap_or_default();
        if chain_deposit_addresses.is_empty() {
            return Err("reusable quote has no chainDepositAddresses".to_string());
        }
        let mut seen = std::collections::HashSet::new();
        if chain_deposit_addresses
            .iter()
            .any(|entry| !seen.insert(entry.blockchain.as_str()))
        {
            return Err("reusable quote lists a blockchain twice".to_string());
        }
        Ok(Self {
            quote_deposit_address,
            quote_deposit_memo,
            chain_deposit_addresses,
            quote_id,
            correlation_id,
            resolved_at: Utc::now(),
        })
    }
}

/// Whether a listed quote is this DAO's reusable deposit set.
fn is_reusable_set_for(attributes: &Value, dao_id: &str) -> bool {
    let field = |key: &str| attributes.get(key).and_then(Value::as_str).unwrap_or("");
    field("originAsset") == ANY_INPUT_ORIGIN_ASSET
        && field("destinationAsset") == ANY_INPUT_DESTINATION_ASSET
        && field("confidentiality").eq_ignore_ascii_case(CONFIDENTIALITY)
        && accounts_equal(field("recipient"), dao_id)
        && accounts_equal(field("refundTo"), dao_id)
}

pub async fn load_cached(
    pool: &PgPool,
    dao_id: &str,
) -> Result<Option<ReusableDepositAddresses>, sqlx::Error> {
    let stored: Option<Option<Value>> = sqlx::query_scalar(
        "SELECT confidential_reusable_deposit FROM monitored_accounts WHERE account_id = $1",
    )
    .bind(dao_id)
    .fetch_optional(pool)
    .await?;
    Ok(stored.flatten().and_then(|value| {
        serde_json::from_value(value)
            .inspect_err(|e| {
                tracing::warn!(dao_id, "stored reusable deposit set is unreadable: {e}")
            })
            .ok()
    }))
}

async fn store_cached(
    pool: &PgPool,
    dao_id: &str,
    set: &ReusableDepositAddresses,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_reusable_deposit = $2,
            confidential_reusable_deposit_updated_at = NOW(),
            updated_at = NOW()
        WHERE account_id = $1
        "#,
    )
    .bind(dao_id)
    .bind(serde_json::to_value(set).expect("reusable deposit set serialises"))
    .execute(pool)
    .await?;
    Ok(())
}

/// Forget the cached set so the next request re-discovers it (1Click no
/// longer knows the quote).
pub async fn clear_cached(pool: &PgPool, dao_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_reusable_deposit = NULL,
            confidential_reusable_deposit_updated_at = NOW(),
            updated_at = NOW()
        WHERE account_id = $1
        "#,
    )
    .bind(dao_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub struct ReusableDepositResolver<'a> {
    state: &'a Arc<AppState>,
}

impl<'a> ReusableDepositResolver<'a> {
    pub fn new(state: &'a Arc<AppState>) -> Self {
        Self { state }
    }

    /// The DAO's reusable deposit set: cached, else discovered from 1Click,
    /// else created. Needs the DAO's 1Click JWT for the 1Click paths.
    pub async fn resolve(
        &self,
        dao_id: &AccountIdRef,
    ) -> Result<ReusableDepositAddresses, (StatusCode, String)> {
        let pool = &self.state.db_pool;
        if let Some(cached) = load_cached(pool, dao_id.as_str()).await.map_err(db_error)? {
            return Ok(cached);
        }
        let jwt = refresh_dao_jwt(self.state, dao_id).await?;
        let set = match self.discover(dao_id.as_str(), &jwt).await? {
            Some(existing) => existing,
            None => match self.create(dao_id.as_str(), &jwt).await {
                Ok(created) => created,
                // 1Click rejects a second set for the account: the listing
                // lagged the create, so look again before giving up.
                Err((StatusCode::BAD_REQUEST, message)) => self
                    .discover(dao_id.as_str(), &jwt)
                    .await?
                    .ok_or((StatusCode::BAD_REQUEST, message))?,
                Err(error) => return Err(error),
            },
        };
        store_cached(pool, dao_id.as_str(), &set)
            .await
            .map_err(db_error)?;
        tracing::info!(
            dao_id = dao_id.as_str(),
            chains = set.chain_deposit_addresses.len(),
            "resolved reusable confidential deposit set"
        );
        Ok(set)
    }

    /// `GET /v0/quotes?filter[swapType]=ANY_INPUT`, following `links.next`
    /// until this DAO's set is found.
    async fn discover(
        &self,
        dao_id: &str,
        jwt: &str,
    ) -> Result<Option<ReusableDepositAddresses>, (StatusCode, String)> {
        let base = Url::parse(&self.state.env_vars.confidential_api_url).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("invalid CONFIDENTIAL_API_URL: {e}"),
            )
        })?;
        let mut next = Some(format!("{QUOTES_PATH}?filter[swapType]=ANY_INPUT"));
        let mut seen = std::collections::HashSet::new();
        let mut incompatible = false;
        while let Some(path) = next.take() {
            if seen.len() >= MAX_QUOTE_PAGES {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "1Click quote listing exceeded its page limit".to_string(),
                ));
            }
            let url = base.join(&path).map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("invalid 1Click quote pagination link: {e}"),
                )
            })?;
            if url.origin() != base.origin() || url.path() != QUOTES_PATH {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "1Click quote pagination link left the quotes endpoint".to_string(),
                ));
            }
            let normalized = match url.query() {
                Some(query) => format!("{}?{query}", url.path()),
                None => url.path().to_string(),
            };
            if !seen.insert(normalized) {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "1Click quote pagination did not advance".to_string(),
                ));
            }
            let page = self.get_json(url, jwt).await?;
            let items = page
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    (
                        StatusCode::BAD_GATEWAY,
                        "1Click quote listing has no data array".to_string(),
                    )
                })?;
            for item in items {
                let Some(attributes) = item.get("attributes") else {
                    continue;
                };
                if attributes.get("originAsset").and_then(Value::as_str) != Some(ANY_INPUT_ORIGIN_ASSET)
                    || attributes.get("destinationAsset").and_then(Value::as_str)
                        != Some(ANY_INPUT_DESTINATION_ASSET)
                {
                    continue;
                }
                if is_reusable_set_for(attributes, dao_id) {
                    let quote_id = item.get("id").and_then(Value::as_str).map(str::to_string);
                    return ReusableDepositAddresses::from_quote(attributes, quote_id, None)
                        .map(Some)
                        .map_err(|e| (StatusCode::BAD_GATEWAY, e));
                }
                incompatible = true;
            }
            next = page
                .get("links")
                .and_then(|links| links.get("next"))
                .and_then(Value::as_str)
                .filter(|link| !link.is_empty())
                .map(str::to_string);
        }
        if incompatible {
            return Err((
                StatusCode::CONFLICT,
                "An incompatible reusable deposit address set already exists for this treasury"
                    .to_string(),
            ));
        }
        Ok(None)
    }

    async fn create(
        &self,
        dao_id: &str,
        jwt: &str,
    ) -> Result<ReusableDepositAddresses, (StatusCode, String)> {
        let url = format!("{}/v0/quote", self.state.env_vars.confidential_api_url);
        let mut body = serde_json::json!({
            "dry": false,
            "swapType": "ANY_INPUT",
            "originAsset": ANY_INPUT_ORIGIN_ASSET,
            "depositType": "INTENTS",
            "destinationAsset": ANY_INPUT_DESTINATION_ASSET,
            "amount": "0",
            "slippageTolerance": SLIPPAGE_TOLERANCE_BPS,
            "recipient": dao_id,
            "recipientType": "CONFIDENTIAL_INTENTS",
            "confidentiality": CONFIDENTIALITY,
            "refundTo": dao_id,
            "refundType": "INTENTS",
            "deadline": REUSABLE_QUOTE_DEADLINE,
        });
        if let Some(referral) = &self.state.env_vars.oneclick_referral {
            body["referral"] = Value::String(referral.clone());
        }
        let response = send_oneclick_request(self.state, &url, &body, Some(jwt)).await?;
        let quote = response.get("quote").ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                "reusable quote response has no quote object".to_string(),
            )
        })?;
        let correlation_id = response
            .get("correlationId")
            .and_then(Value::as_str)
            .map(str::to_string);
        ReusableDepositAddresses::from_quote(quote, None, correlation_id)
            .map_err(|e| (StatusCode::BAD_GATEWAY, e))
    }

    async fn get_json(&self, url: Url, jwt: &str) -> Result<Value, (StatusCode, String)> {
        let mut request = self
            .state
            .http_client
            .get(url.clone())
            .header("Authorization", format!("Bearer {jwt}"));
        if let Some(api_key) = &self.state.env_vars.oneclick_api_key {
            request = request.header("x-api-key", api_key);
        }
        let response = request.send().await.map_err(|e| {
            tracing::error!("1Click request to {} failed: {}", url.path(), e);
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to call 1Click API: {e}"),
            )
        })?;
        let status = response.status();
        let body: Value = response.json().await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to parse 1Click response: {e}"),
            )
        })?;
        if !status.is_success() {
            let message = body
                .get("message")
                .or_else(|| body.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown error from 1Click API");
            return Err((
                StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
                sanitize_sensitive_text(message),
            ));
        }
        Ok(body)
    }
}

/// Prefix of tracker provider keys for reusable-address deposits.
pub const REUSABLE_DEPOSIT_KEY_PREFIX: &str = "rda:";
const WITHDRAWALS_PATH: &str = "/v0/any-input/withdrawals";
const WITHDRAWALS_PAGE_LIMIT: u32 = 50;

/// One settled payout of the reusable quote: one deposit credited (or
/// failed). `hash` is the payout transaction, not the depositor's.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReusableWithdrawal {
    pub status: String,
    #[serde(default)]
    pub amount_out: Option<String>,
    pub amount_out_formatted: String,
    #[serde(default)]
    pub amount_out_usd: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub hash: String,
}

impl ReusableWithdrawal {
    /// Stable tracker key: a payout is identified by its hash and time.
    pub fn provider_deposit_key(&self) -> String {
        format!(
            "{REUSABLE_DEPOSIT_KEY_PREFIX}{}:{}",
            self.hash,
            self.timestamp.to_rfc3339()
        )
    }

    pub fn is_success(&self) -> bool {
        self.status.trim().eq_ignore_ascii_case("SUCCESS")
    }

    pub fn is_failed(&self) -> bool {
        self.status.trim().eq_ignore_ascii_case("FAILED")
    }

    /// Decimal-adjusted credited amount, as the ledger stores it.
    pub fn amount(&self) -> Option<bigdecimal::BigDecimal> {
        self.amount_out_formatted.trim().parse().ok()
    }
}

/// `GET /v0/any-input/withdrawals` page, newest first.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReusableWithdrawals {
    /// `1cs_v1:original`: the credited token is not identified per payout.
    pub asset: String,
    pub recipient: String,
    #[serde(default, deserialize_with = "one_or_many")]
    pub withdrawals: Vec<ReusableWithdrawal>,
}

/// 1Click's schema declares `withdrawals` as one object; the live API
/// returns an array. Accept both.
fn one_or_many<'de, D>(deserializer: D) -> Result<Vec<ReusableWithdrawal>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        Many(Vec<ReusableWithdrawal>),
        One(ReusableWithdrawal),
        Null(()),
    }
    Ok(match OneOrMany::deserialize(deserializer)? {
        OneOrMany::Many(items) => items,
        OneOrMany::One(item) => vec![item],
        OneOrMany::Null(()) => Vec::new(),
    })
}

impl ReusableDepositResolver<'_> {
    /// Latest payouts of the DAO's reusable quote (newest first, one page).
    pub async fn withdrawals(
        &self,
        dao_id: &AccountIdRef,
        set: &ReusableDepositAddresses,
    ) -> Result<ReusableWithdrawals, (StatusCode, String)> {
        let jwt = refresh_dao_jwt(self.state, dao_id).await?;
        let mut url = Url::parse(&self.state.env_vars.confidential_api_url)
            .and_then(|base| base.join(WITHDRAWALS_PATH))
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("invalid CONFIDENTIAL_API_URL: {e}"),
                )
            })?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("depositAddress", &set.quote_deposit_address);
            if let Some(memo) = &set.quote_deposit_memo {
                query.append_pair("depositMemo", memo);
            }
            query.append_pair("limit", &WITHDRAWALS_PAGE_LIMIT.to_string());
            query.append_pair("sortOrder", "desc");
            query.append_pair("page", "1");
        }
        let body = self.get_json(url, &jwt).await?;
        let page: ReusableWithdrawals = serde_json::from_value(body).map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("invalid 1Click withdrawals response: {e}"),
            )
        })?;
        if !accounts_equal(&page.recipient, dao_id.as_str()) {
            return Err((
                StatusCode::BAD_GATEWAY,
                "1Click withdrawals belong to another recipient".to_string(),
            ));
        }
        Ok(page)
    }
}

fn db_error(error: sqlx::Error) -> (StatusCode, String) {
    tracing::error!("reusable deposit set storage failed: {error}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to read reusable deposit set".to_string(),
    )
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::services::{CredentialScope, TokenBundle, TokenKeyring};
    use crate::utils::test_utils::build_test_state;

    const DAO: &str = "rda-test.sputnik-dao.near";
    const JWT: &str = "rda-access-token";
    const KEYRING: &str =
        r#"{"active":"k1","keys":{"k1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}}"#;

    fn keyring() -> TokenKeyring {
        TokenKeyring::parse(KEYRING).expect("valid test keyring")
    }

    async fn seed_authenticated_dao(pool: &PgPool) {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, is_confidential_account) VALUES ($1, TRUE)",
        )
        .bind(DAO)
        .execute(pool)
        .await
        .expect("seed account");
        let envelope = keyring()
            .encrypt(
                DAO,
                CredentialScope::Dao,
                &TokenBundle {
                    access_token: JWT.to_string(),
                    refresh_token: "rda-refresh".to_string(),
                },
            )
            .expect("encrypt envelope");
        sqlx::query(
            r#"
            UPDATE monitored_accounts
            SET confidential_credentials_enc = $1,
                confidential_token_expires_at = NOW() + INTERVAL '1 hour'
            WHERE account_id = $2
            "#,
        )
        .bind(envelope)
        .bind(DAO)
        .execute(pool)
        .await
        .expect("seed tokens");
    }

    fn state_with_mock(pool: PgPool, mock: &MockServer) -> Arc<AppState> {
        let mut state = build_test_state(pool);
        state.env_vars.confidential_api_url = mock.uri();
        state.env_vars.oneclick_api_key = Some("test-key".to_string());
        state.confidential_keyring = Some(Arc::new(keyring()));
        Arc::new(state)
    }

    fn quote_json(recipient: &str) -> Value {
        serde_json::json!({
            "depositAddress": "rda-monitoring-account",
            "depositMemo": null,
            "chainDepositAddresses": [
                { "blockchain": "near", "address": "rda-near-funding" },
                { "blockchain": "base", "address": "0xbase" },
                { "blockchain": "stellar", "address": "GSTELLAR", "memo": "123" }
            ],
            "recipient": recipient,
            "refundTo": recipient,
            "originAsset": ANY_INPUT_ORIGIN_ASSET,
            "destinationAsset": ANY_INPUT_DESTINATION_ASSET,
            "confidentiality": "basic"
        })
    }

    /// An ANY_INPUT quote that is not a deposit set (asset-specific fee
    /// collection): skipped by discovery, never a conflict.
    fn fee_quote_json() -> Value {
        let mut quote = quote_json(DAO);
        quote["originAsset"] = Value::String("nep141:wrap.near".to_string());
        quote
    }

    fn listing(items: Vec<Value>, next: Option<&str>) -> Value {
        serde_json::json!({ "data": items, "links": { "next": next } })
    }

    fn listed(id: &str, attributes: Value) -> Value {
        serde_json::json!({ "type": "quotes", "id": id, "attributes": attributes })
    }

    #[test]
    fn chain_entries_map_to_bridge_chain_ids() {
        let entry = |blockchain: &str| ChainDepositAddress {
            blockchain: blockchain.to_string(),
            address: "x".to_string(),
            memo: None,
        };
        assert_eq!(entry("base").bridge_chain_id(), "eth:8453");
        assert_eq!(entry("arb").bridge_chain_id(), "eth:42161");
        assert_eq!(entry("eth").bridge_chain_id(), "eth:1");
        assert_eq!(entry("btc").bridge_chain_id(), "btc:mainnet");
        assert_eq!(entry("sol").bridge_chain_id(), "sol:mainnet");
        assert_eq!(entry("near").bridge_chain_id(), "near:mainnet");
        assert_eq!(entry("hypercore").bridge_chain_id(), "hypercore:mainnet");
        assert_eq!(entry("pol").bridge_chain_id(), "eth:137");
    }

    #[test]
    fn set_parses_from_quote_and_selects_by_chain() {
        let set = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();
        assert_eq!(set.quote_deposit_address, "rda-monitoring-account");
        assert_eq!(
            set.address_for_chain("eth:8453").map(|e| e.address.as_str()),
            Some("0xbase")
        );
        assert_eq!(
            set.address_for_chain("stellar:mainnet")
                .and_then(|e| e.memo.as_deref()),
            Some("123")
        );
        assert!(set.address_for_chain("btc:mainnet").is_none());
        assert!(set.owns_address("rda-monitoring-account"));
        assert!(set.owns_address("0xbase"));
        assert!(!set.owns_address("someone-else"));
    }

    #[test]
    fn set_rejects_quotes_without_funding_addresses() {
        let mut quote = quote_json(DAO);
        quote["chainDepositAddresses"] = serde_json::json!([]);
        assert!(ReusableDepositAddresses::from_quote(&quote, None, None).is_err());
        let mut quote = quote_json(DAO);
        quote["chainDepositAddresses"] = serde_json::json!([
            { "blockchain": "near", "address": "a" },
            { "blockchain": "near", "address": "b" }
        ]);
        assert!(ReusableDepositAddresses::from_quote(&quote, None, None).is_err());
    }

    #[sqlx::test]
    async fn resolve_uses_the_listed_set_and_caches_it(pool: PgPool) {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(QUOTES_PATH))
            .and(query_param("filter[swapType]", "ANY_INPUT"))
            .and(header("Authorization", format!("Bearer {JWT}").as_str()))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(listing(
                vec![
                    listed("other", quote_json("someone-else.near")),
                    listed("mine", quote_json(DAO)),
                ],
                None,
            )))
            .expect(1)
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v0/quote"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&mock)
            .await;
        seed_authenticated_dao(&pool).await;
        let state = state_with_mock(pool.clone(), &mock);

        let dao = AccountIdRef::new(DAO).unwrap();
        let set = ReusableDepositResolver::new(&state)
            .resolve(dao)
            .await
            .expect("resolve");
        assert_eq!(set.quote_id.as_deref(), Some("mine"));
        assert_eq!(set.chain_deposit_addresses.len(), 3);

        let again = ReusableDepositResolver::new(&state)
            .resolve(dao)
            .await
            .expect("cached resolve");
        assert_eq!(again, set);
        assert_eq!(load_cached(&pool, DAO).await.unwrap(), Some(set));
    }

    #[sqlx::test]
    async fn resolve_follows_pagination_then_creates(pool: PgPool) {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(QUOTES_PATH))
            .and(query_param("page[after]", "c1"))
            // Mounted first: wiremock answers with the first matching mock.
            .respond_with(ResponseTemplate::new(200).set_body_json(listing(vec![], None)))
            .expect(1)
            .mount(&mock)
            .await;
        Mock::given(method("GET"))
            .and(path(QUOTES_PATH))
            .and(query_param("filter[swapType]", "ANY_INPUT"))
            .respond_with(ResponseTemplate::new(200).set_body_json(listing(
                vec![listed("fee-collector", fee_quote_json())],
                Some("/v0/quotes?filter[swapType]=ANY_INPUT&page[after]=c1"),
            )))
            .expect(1)
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v0/quote"))
            .and(header("Authorization", format!("Bearer {JWT}").as_str()))
            .and(wiremock::matchers::body_partial_json(serde_json::json!({
                "swapType": "ANY_INPUT",
                "originAsset": ANY_INPUT_ORIGIN_ASSET,
                "destinationAsset": ANY_INPUT_DESTINATION_ASSET,
                "recipient": DAO,
                "refundTo": DAO,
                "confidentiality": "basic",
                "deadline": REUSABLE_QUOTE_DEADLINE,
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "correlationId": "corr-1",
                "timestamp": "2026-10-28T00:00:00.000Z",
                "quote": quote_json(DAO),
            })))
            .expect(1)
            .mount(&mock)
            .await;
        seed_authenticated_dao(&pool).await;
        let state = state_with_mock(pool.clone(), &mock);

        let set = ReusableDepositResolver::new(&state)
            .resolve(AccountIdRef::new(DAO).unwrap())
            .await
            .expect("resolve");
        assert_eq!(set.correlation_id.as_deref(), Some("corr-1"));
        assert!(set.quote_id.is_none());
        assert_eq!(set.quote_deposit_address, "rda-monitoring-account");
    }

    #[sqlx::test]
    async fn create_rejection_falls_back_to_a_second_listing(pool: PgPool) {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(QUOTES_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(listing(vec![], None)))
            .up_to_n_times(1)
            .mount(&mock)
            .await;
        Mock::given(method("POST"))
            .and(path("/v0/quote"))
            .respond_with(
                ResponseTemplate::new(400)
                    .set_body_json(serde_json::json!({ "message": "quote already exists" })),
            )
            .expect(1)
            .mount(&mock)
            .await;
        Mock::given(method("GET"))
            .and(path(QUOTES_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(listing(
                vec![listed("late", quote_json(DAO))],
                None,
            )))
            .mount(&mock)
            .await;
        seed_authenticated_dao(&pool).await;
        let state = state_with_mock(pool.clone(), &mock);

        let set = ReusableDepositResolver::new(&state)
            .resolve(AccountIdRef::new(DAO).unwrap())
            .await
            .expect("resolve");
        assert_eq!(set.quote_id.as_deref(), Some("late"));
    }

    #[sqlx::test]
    async fn incompatible_existing_set_is_a_conflict(pool: PgPool) {
        let mock = MockServer::start().await;
        let mut public = quote_json(DAO);
        public["confidentiality"] = Value::String("public".to_string());
        Mock::given(method("GET"))
            .and(path(QUOTES_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(listing(
                vec![listed("public", public)],
                None,
            )))
            .mount(&mock)
            .await;
        seed_authenticated_dao(&pool).await;
        let state = state_with_mock(pool.clone(), &mock);

        let error = ReusableDepositResolver::new(&state)
            .resolve(AccountIdRef::new(DAO).unwrap())
            .await
            .expect_err("conflict");
        assert_eq!(error.0, StatusCode::CONFLICT);
        assert!(load_cached(&pool, DAO).await.unwrap().is_none());
    }

    #[test]
    fn withdrawals_accept_one_object_or_an_array() {
        let one: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
            "asset": "1cs_v1:original",
            "recipient": DAO,
            "withdrawals": {
                "status": "SUCCESS", "amountOutFormatted": "0.5",
                "timestamp": "2026-10-28T10:00:00.000Z", "hash": "h1"
            }
        }))
        .unwrap();
        assert_eq!(one.withdrawals.len(), 1);
        assert_eq!(
            one.withdrawals[0].provider_deposit_key(),
            "rda:h1:2026-10-28T10:00:00+00:00"
        );
        assert_eq!(
            one.withdrawals[0].amount(),
            Some("0.5".parse::<bigdecimal::BigDecimal>().unwrap())
        );
        let many: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
            "asset": "1cs_v1:original",
            "recipient": DAO,
            "withdrawals": [
                { "status": "SUCCESS", "amountOutFormatted": "1", "timestamp": "2026-10-28T10:00:00Z", "hash": "a" },
                { "status": "FAILED", "amountOutFormatted": "2", "timestamp": "2026-10-28T09:00:00Z", "hash": "b" }
            ]
        }))
        .unwrap();
        assert_eq!(many.withdrawals.len(), 2);
        assert!(many.withdrawals[0].is_success());
        assert!(many.withdrawals[1].is_failed());
        let none: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
            "asset": "1cs_v1:original", "recipient": DAO
        }))
        .unwrap();
        assert!(none.withdrawals.is_empty());
    }

    #[sqlx::test]
    async fn withdrawals_are_read_for_the_quote_address_with_the_dao_jwt(pool: PgPool) {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(WITHDRAWALS_PATH))
            .and(query_param("depositAddress", "rda-monitoring-account"))
            .and(query_param("limit", "50"))
            .and(query_param("sortOrder", "desc"))
            .and(header("Authorization", format!("Bearer {JWT}").as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "asset": "1cs_v1:original",
                "recipient": DAO,
                "affiliateRecipient": "",
                "withdrawals": [{
                    "status": "SUCCESS", "amountOut": "500000", "amountOutFormatted": "0.5",
                    "amountOutUsd": "0.5", "withdrawFee": "0", "withdrawFeeFormatted": "0",
                    "withdrawFeeUsd": "0", "timestamp": "2026-10-28T10:00:00.000Z", "hash": "payout-1"
                }]
            })))
            .expect(1)
            .mount(&mock)
            .await;
        seed_authenticated_dao(&pool).await;
        let state = state_with_mock(pool.clone(), &mock);
        let set = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();

        let page = ReusableDepositResolver::new(&state)
            .withdrawals(AccountIdRef::new(DAO).unwrap(), &set)
            .await
            .expect("withdrawals");
        assert_eq!(page.withdrawals.len(), 1);
        assert_eq!(page.withdrawals[0].hash, "payout-1");
    }
}
