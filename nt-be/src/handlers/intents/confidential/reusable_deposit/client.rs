//! 1Click operations on the reusable set: the quote listing, the create
//! call and the payout feed.

use chrono::{DateTime, Utc};
use near_account_id::AccountIdRef;
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::Value;

use crate::handlers::intents::confidential::refresh_dao_jwt;
use crate::handlers::intents::confidential::types::accounts_equal;
use crate::handlers::intents::oneclick::OneClickClient;
use crate::utils::url::api_url_or_500;

use super::resolver::ReusableDepositResolver;
use super::types::{
    ANY_INPUT_DESTINATION_ASSET, ANY_INPUT_ORIGIN_ASSET, CONFIDENTIALITY, REUSABLE_QUOTE_DEADLINE,
    ReusableDepositAddresses, is_reusable_set_for,
};

const SLIPPAGE_TOLERANCE_BPS: u32 = 50;
pub(super) const QUOTES_PATH: &str = "/v0/quotes";
const MAX_QUOTE_PAGES: usize = 50;
/// Prefix of tracker provider keys for reusable-address deposits.
const REUSABLE_DEPOSIT_KEY_PREFIX: &str = "rda:";
pub(super) const WITHDRAWALS_PATH: &str = "/v0/any-input/withdrawals";
pub const WITHDRAWALS_PAGE_LIMIT: u32 = 50;

impl ReusableDepositResolver<'_> {
    /// `GET /v0/quotes?filter[swapType]=ANY_INPUT`, following `links.next`
    /// until this DAO's set is found.
    pub(super) async fn discover(
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
            let page = OneClickClient::new(self.state).get(url, Some(jwt)).await?;
            let items = page.get("data").and_then(Value::as_array).ok_or_else(|| {
                (
                    StatusCode::BAD_GATEWAY,
                    "1Click quote listing has no data array".to_string(),
                )
            })?;
            for item in items {
                let Some(attributes) = item.get("attributes") else {
                    continue;
                };
                if attributes.get("originAsset").and_then(Value::as_str)
                    != Some(ANY_INPUT_ORIGIN_ASSET)
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

    pub(super) async fn create(
        &self,
        dao_id: &str,
        jwt: &str,
    ) -> Result<ReusableDepositAddresses, (StatusCode, String)> {
        let url = api_url_or_500(&self.state.env_vars.confidential_api_url, "v0/quote")?;
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
        let response = OneClickClient::new(self.state)
            .post(url, &body, Some(jwt))
            .await?;
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
}

/// One payout of the reusable quote: one deposit credited (or failed).
/// `hash` is the payout transaction, not the depositor's, and is empty
/// while the payout is still PROCESSING.
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
    #[serde(default)]
    pub hash: String,
}

impl ReusableWithdrawal {
    /// Stable tracker key: the payout's timestamp. The hash is not part of
    /// it because 1Click fills it in only once the payout succeeds, and a
    /// key that changes mid-flight would record the same deposit twice.
    pub fn provider_deposit_key(&self) -> String {
        format!(
            "{REUSABLE_DEPOSIT_KEY_PREFIX}{}",
            self.timestamp.to_rfc3339()
        )
    }

    /// The payout hash once 1Click has one.
    pub fn payout_hash(&self) -> Option<String> {
        Some(self.hash.trim())
            .filter(|hash| !hash.is_empty())
            .map(str::to_string)
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

/// Why the reusable quote's payouts could not be read.
#[derive(Debug)]
pub enum WithdrawalsError {
    /// 1Click no longer serves the cached quote as this DAO's: the cached
    /// set is stale and must be re-resolved.
    StaleSet(String),
    Upstream(StatusCode, String),
}

impl std::fmt::Display for WithdrawalsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StaleSet(reason) => write!(f, "stale reusable deposit set: {reason}"),
            Self::Upstream(status, message) => write!(f, "{status}: {message}"),
        }
    }
}

impl ReusableDepositResolver<'_> {
    /// Latest payouts of the DAO's reusable quote (newest first, first page).
    pub async fn withdrawals(
        &self,
        dao_id: &AccountIdRef,
        set: &ReusableDepositAddresses,
    ) -> Result<ReusableWithdrawals, WithdrawalsError> {
        self.withdrawals_page(dao_id, set, 1).await
    }

    /// One page of the DAO's payouts, newest first, `WITHDRAWALS_PAGE_LIMIT`
    /// per page.
    pub async fn withdrawals_page(
        &self,
        dao_id: &AccountIdRef,
        set: &ReusableDepositAddresses,
        page: u32,
    ) -> Result<ReusableWithdrawals, WithdrawalsError> {
        let jwt = refresh_dao_jwt(self.state, dao_id)
            .await
            .map_err(|(status, message)| WithdrawalsError::Upstream(status, message))?;
        let mut url = Url::parse(&self.state.env_vars.confidential_api_url)
            .and_then(|base| base.join(WITHDRAWALS_PATH))
            .map_err(|e| {
                WithdrawalsError::Upstream(
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
            query.append_pair("page", &page.to_string());
        }
        // 1Click answers 404 for a quote address it no longer serves.
        let body = OneClickClient::new(self.state)
            .get(url, Some(&jwt))
            .await
            .map_err(|(status, message)| match status {
                StatusCode::NOT_FOUND => WithdrawalsError::StaleSet(message),
                _ => WithdrawalsError::Upstream(status, message),
            })?;
        let page: ReusableWithdrawals = serde_json::from_value(body).map_err(|e| {
            WithdrawalsError::Upstream(
                StatusCode::BAD_GATEWAY,
                format!("invalid 1Click withdrawals response: {e}"),
            )
        })?;
        if !accounts_equal(&page.recipient, dao_id.as_str()) {
            return Err(WithdrawalsError::StaleSet(
                "1Click withdrawals belong to another recipient".to_string(),
            ));
        }
        Ok(page)
    }
}
