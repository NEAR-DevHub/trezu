//! Domain models of the reusable set and the predicates over 1Click's
//! listing shape.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::handlers::intents::bridge_tokens::fallback_chain_id_for_name;
use crate::handlers::intents::confidential::types::accounts_equal;

/// 1Click requires this fixed deadline for reusable quotes; never derive it
/// from the current time.
pub const REUSABLE_QUOTE_DEADLINE: &str = "2038-01-01T00:00:00.000Z";
pub(super) const ANY_INPUT_ORIGIN_ASSET: &str = "1cs_v1:any";
pub(super) const ANY_INPUT_DESTINATION_ASSET: &str = "1cs_v1:original";
pub(super) const CONFIDENTIALITY: &str = "basic";

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

    pub(super) fn from_quote(
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
pub(super) fn is_reusable_set_for(attributes: &Value, dao_id: &str) -> bool {
    let field = |key: &str| attributes.get(key).and_then(Value::as_str).unwrap_or("");
    field("originAsset") == ANY_INPUT_ORIGIN_ASSET
        && field("destinationAsset") == ANY_INPUT_DESTINATION_ASSET
        && field("confidentiality").eq_ignore_ascii_case(CONFIDENTIALITY)
        && accounts_equal(field("recipient"), dao_id)
        && accounts_equal(field("refundTo"), dao_id)
}
