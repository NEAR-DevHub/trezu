use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use super::account_id::bare_account;
use super::enums::DepositType;

/// Deserialized 1Click `/v0/account/history` page.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryApiPage {
    pub items: Vec<HistoryApiItem>,
    pub next_cursor: Option<String>,
    pub prev_cursor: Option<String>,
}

/// One entry in the `quoteTransactions` array returned by the 1Click history API.
/// Represents an on-chain deposit transaction: the sender address and tx hash.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuoteTransaction {
    pub sender: Option<String>,
    pub tx_hash: Option<String>,
}

/// One history row from 1Click, including projection fields read by classify.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryApiItem {
    pub created_at: DateTime<Utc>,
    pub deposit_address: String,
    pub deposit_memo: Option<String>,
    pub status: String,
    pub deposit_type: String,
    pub recipient_type: Option<String>,
    pub recipient: Option<String>,
    pub origin_asset: Option<String>,
    /// Absent on a deposit-only entry: a plain transfer into a 1Click deposit
    /// address credited to the confidential account (agentic.sputnik-dao.near,
    /// 2026-11-05: 1 USDC sent by Sputnik proposal 65 from an external SDK).
    /// 1Click then reports only the origin side — no `destinationAsset`,
    /// `recipient` or `amountOut*` — and the credited asset is `originAsset`.
    #[serde(default)]
    pub destination_asset: Option<String>,
    #[serde(default)]
    pub amount_in_formatted: Option<String>,
    #[serde(default)]
    pub amount_in_usd: Option<String>,
    #[serde(default)]
    pub amount_out_formatted: Option<String>,
    #[serde(default)]
    pub amount_out_usd: Option<String>,
    #[serde(default)]
    pub refund_to: Option<String>,
    #[serde(default)]
    pub refund_type: Option<String>,
    /// On-chain deposit transactions from the source chain (e.g. EVM).
    /// The first entry's `sender` and `tx_hash` identify who deposited and on which tx.
    #[serde(default)]
    pub quote_transactions: Vec<QuoteTransaction>,
}

impl HistoryApiItem {
    /// The sender address from the first `quoteTransactions` entry, if present.
    pub fn first_quote_sender(&self) -> Option<&str> {
        self.quote_transactions.first()?.sender.as_deref()
    }

    /// The tx hash from the first `quoteTransactions` entry, if present.
    pub fn first_quote_tx_hash(&self) -> Option<&str> {
        self.quote_transactions.first()?.tx_hash.as_deref()
    }

    /// A deposit-only entry: a public-side deposit (`ORIGIN_CHAIN` or
    /// `INTENTS`) into the confidential account for which 1Click reports the
    /// origin side only, with `recipient`, `destinationAsset` and
    /// `amountOutFormatted` all absent (see `destination_asset`). Any other
    /// entry missing some of those fields is malformed, not this shape.
    pub fn is_deposit_only(&self) -> bool {
        let public_to_confidential = matches!(
            DepositType::parse(&self.deposit_type),
            DepositType::Intents | DepositType::OriginChain
        ) && self
            .recipient_type
            .as_deref()
            .is_some_and(|value| DepositType::parse(value) == DepositType::ConfidentialIntents);
        public_to_confidential
            && self.recipient.is_none()
            && self.destination_asset.is_none()
            && self.amount_out_formatted.is_none()
    }

    /// The asset credited by this entry: the destination asset, or for a
    /// deposit-only entry the origin asset. `None` for any other entry
    /// without a destination asset.
    pub fn credited_asset(&self) -> Option<&str> {
        match self.destination_asset.as_deref() {
            Some(asset) => Some(asset),
            None if self.is_deposit_only() => self.origin_asset.as_deref(),
            None => None,
        }
    }
}

/// Wrapper kept for bronze ingest: typed item + original JSON for storage.
#[derive(Debug, Clone)]
pub struct HistoryApiEvent {
    pub item: HistoryApiItem,
    pub raw_payload: Value,
}

/// Typed view of `confidential_intents.quote_metadata` JSONB.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidentialQuoteMetadata {
    #[serde(default)]
    pub quote: Option<ConfidentialQuoteDetails>,
    #[serde(default)]
    pub quote_request: Option<ConfidentialQuoteRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidentialQuoteDetails {
    pub deposit_address: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidentialQuoteRequest {
    pub recipient: Option<String>,
    #[serde(default)]
    pub refund_to: Option<String>,
    #[serde(default)]
    pub recipient_type: Option<String>,
    #[serde(default)]
    pub refund_type: Option<String>,
    #[serde(default)]
    pub origin_asset: Option<String>,
    #[serde(default)]
    pub destination_asset: Option<String>,
}

fn normalize_quote_request_field(quote_request: &mut serde_json::Map<String, Value>, field: &str) {
    let Some(Value::String(value)) = quote_request.get(field).cloned() else {
        return;
    };
    quote_request.insert(field.to_string(), Value::String(bare_account(&value)));
}

/// Strip `chain:` prefixes from account fields in `confidential_intents.quote_metadata` JSONB.
pub fn normalize_quote_metadata_accounts(mut value: Value) -> Value {
    let Some(obj) = value.as_object_mut() else {
        return value;
    };
    if let Some(Value::Object(quote_request)) = obj.get_mut("quoteRequest") {
        normalize_quote_request_field(quote_request, "recipient");
        normalize_quote_request_field(quote_request, "refundTo");
    }
    value
}

impl ConfidentialQuoteMetadata {
    pub fn from_value(value: &Value) -> Option<Self> {
        serde_json::from_value(value.clone()).ok()
    }

    pub fn deposit_address(&self) -> Option<&str> {
        self.quote
            .as_ref()
            .and_then(|q| q.deposit_address.as_deref())
    }

    pub fn quote_request_recipient(&self) -> Option<&str> {
        self.quote_request
            .as_ref()
            .and_then(|q| q.recipient.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(fields: Value) -> HistoryApiItem {
        let mut base = serde_json::json!({
            "createdAt": "2026-11-05T03:21:21.666734Z",
            "depositAddress": "c25f7c3ab12474a0ca6c39216680d9e6ebbf9907f3aa018e77a1cd616634eb1a",
            "status": "SUCCESS",
            "depositType": "ORIGIN_CHAIN",
            "recipientType": "CONFIDENTIAL_INTENTS",
            "originAsset": "nep141:usdc.near",
            "amountInFormatted": "1.0"
        });
        base.as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        serde_json::from_value(base).expect("item should parse")
    }

    /// agentic.sputnik-dao.near, 2026-11-05: only the full origin-only shape
    /// credits the origin asset; a cross-asset entry that merely lacks
    /// destinationAsset must not report its source token as the deposit.
    #[test]
    fn credited_asset_takes_origin_only_for_the_deposit_only_shape() {
        let deposit_only = item(serde_json::json!({}));
        assert!(deposit_only.is_deposit_only());
        assert_eq!(deposit_only.credited_asset(), Some("nep141:usdc.near"));

        let normal = item(serde_json::json!({
            "recipient": "dao.near",
            "destinationAsset": "nep141:wrap.near",
            "amountOutFormatted": "0.9"
        }));
        assert!(!normal.is_deposit_only());
        assert_eq!(normal.credited_asset(), Some("nep141:wrap.near"));

        for other in [
            serde_json::json!({ "recipient": "dao.near" }),
            serde_json::json!({ "amountOutFormatted": "0.9" }),
            serde_json::json!({ "depositType": "CONFIDENTIAL_INTENTS" }),
            serde_json::json!({ "recipientType": "DESTINATION_CHAIN" }),
            serde_json::json!({ "recipientType": null }),
        ] {
            let item = item(other.clone());
            assert!(!item.is_deposit_only(), "{other}");
            assert_eq!(item.credited_asset(), None, "{other}");
        }
    }

    #[test]
    fn history_api_item_deserializes_sample_row() {
        let raw = serde_json::json!({
            "amountOutFormatted": "0.1",
            "amountOutUsd": "0.1570",
            "createdAt": "2026-05-12T09:05:19.160516Z",
            "depositAddress": "abc",
            "depositType": "CONFIDENTIAL_INTENTS",
            "destinationAsset": "nep141:wrap.near",
            "status": "SUCCESS"
        });
        let item: HistoryApiItem = serde_json::from_value(raw).expect("item should parse");
        assert_eq!(item.deposit_address, "abc");
        assert_eq!(item.amount_out_formatted.as_deref(), Some("0.1"));
        assert!(item.quote_transactions.is_empty());
    }

    #[test]
    fn history_api_item_deserializes_quote_transactions() {
        let raw = serde_json::json!({
            "createdAt": "2026-06-29T16:51:40.541555Z",
            "depositAddress": "46c3fdcb111762208af1e072c832dad91643816898da540057930456bc37eafe",
            "depositType": "INTENTS",
            "destinationAsset": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
            "status": "SUCCESS",
            "quoteTransactions": [
                {
                    "sender": "0xCca16F882B7C0EC5aba541999f7Ee05f858b426B",
                    "txHash": "0x8b46d78a64ab09c0d89bc7f95f2580b2663e7143c2e0d297ee1d397e44a528c7"
                }
            ]
        });
        let item: HistoryApiItem = serde_json::from_value(raw).expect("item should parse");
        assert_eq!(
            item.first_quote_sender(),
            Some("0xCca16F882B7C0EC5aba541999f7Ee05f858b426B")
        );
        assert_eq!(
            item.first_quote_tx_hash(),
            Some("0x8b46d78a64ab09c0d89bc7f95f2580b2663e7143c2e0d297ee1d397e44a528c7")
        );
    }

    #[test]
    fn confidential_quote_metadata_deserializes_camel_case_quote_request() {
        let raw = serde_json::json!({
            "quote": { "depositAddress": "deposit-abc" },
            "quoteRequest": { "recipient": "bob.near" }
        });
        let meta: ConfidentialQuoteMetadata =
            serde_json::from_value(raw).expect("quote metadata should parse");
        assert_eq!(meta.deposit_address(), Some("deposit-abc"));
        assert_eq!(meta.quote_request_recipient(), Some("bob.near"));
    }

    #[test]
    fn normalize_quote_metadata_keeps_bare_near() {
        let raw = serde_json::json!({
            "quoteRequest": {
                "recipient": "bob.near",
                "recipientType": "CONFIDENTIAL_INTENTS",
                "refundTo": "dao.sputnik-dao.near",
                "refundType": "CONFIDENTIAL_INTENTS",
                "destinationAsset": "nep141:wrap.near"
            }
        });
        let normalized = normalize_quote_metadata_accounts(raw);
        assert_eq!(
            normalized["quoteRequest"]["recipient"].as_str(),
            Some("bob.near")
        );
        assert_eq!(
            normalized["quoteRequest"]["refundTo"].as_str(),
            Some("dao.sputnik-dao.near")
        );
    }

    #[test]
    fn normalize_quote_metadata_keeps_bare_evm() {
        let raw = serde_json::json!({
            "quoteRequest": {
                "recipient": "0xabc123",
                "recipientType": "DESTINATION_CHAIN",
                "originAsset": "nep141:wrap.near",
                "destinationAsset": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"
            }
        });
        let normalized = normalize_quote_metadata_accounts(raw);
        assert_eq!(
            normalized["quoteRequest"]["recipient"].as_str(),
            Some("0xabc123")
        );
    }

    #[test]
    fn normalize_quote_metadata_strips_near_prefix() {
        let raw = serde_json::json!({
            "quoteRequest": {
                "recipient": "near:bob.near",
                "recipientType": "CONFIDENTIAL_INTENTS"
            }
        });
        let normalized = normalize_quote_metadata_accounts(raw);
        assert_eq!(
            normalized["quoteRequest"]["recipient"].as_str(),
            Some("bob.near")
        );
    }
}
