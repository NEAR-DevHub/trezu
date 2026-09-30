use bigdecimal::{BigDecimal, ToPrimitive};
use near_api::{AccountId, types::json::U64};
use serde_json::Value;
use std::{collections::HashMap, str::FromStr};

use crate::handlers::{
    notifications::formatting::{
        escape_telegram_html, format_token_label, format_usd, token_meta_for_id,
    },
    proposals::scraper::{
        AssetExchangeInfo, BulkPayment, LockupInfo, PaymentInfo, PaymentProposalType, Proposal,
        ProposalStatus, ProposalType, StakeDelegationInfo, extract_from_description,
    },
    token::metadata::TokenMetadata,
};

const BULK_PAYMENT_CONTRACT_ID: &str = "bulkpayment.near";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedNotificationContent {
    pub notification_type: String,
    pub title: String,
    pub subtitle: String,
    pub action_link: String,
    pub action_text: String,
}

fn format_submitter_for_display(raw: &str) -> String {
    let is_hex_like = raw.len() >= 32 && raw.chars().all(|c| c.is_ascii_hexdigit());
    if is_hex_like {
        let head = &raw[..10];
        let tail = &raw[raw.len().saturating_sub(8)..];
        format!("{head}...{tail}")
    } else {
        raw.to_string()
    }
}

/// Human label for a Sputnik proposal, derived from its `{description, kind}`
/// JSON. Used by the notification detector on `dao_proposals.proposal_kind`.
pub(crate) fn classify_proposal_kind(proposal_json: &Value) -> Option<String> {
    let description = proposal_json
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let kind = proposal_json.get("kind")?.clone();
    if let Some(kind_object) = kind.as_object()
        && kind_object.contains_key("Transfer")
    {
        return Some("Payment".to_string());
    }

    let proposal = Proposal {
        id: 0,
        proposer: String::new(),
        description,
        kind: kind.clone(),
        status: ProposalStatus::InProgress,
        vote_counts: HashMap::new(),
        votes: HashMap::new(),
        submission_time: U64(0),
        last_actions_log: None,
        confidential_metadata: None,
        public_metadata: None,
    };

    let bulk_contract_id: AccountId = BULK_PAYMENT_CONTRACT_ID.parse().ok()?;
    if BulkPayment::from_proposal_with_contract_id(&proposal, &bulk_contract_id).is_some() {
        return Some("Batch Payment".to_string());
    }
    let proposal_action = extract_from_description(&proposal.description, "proposalaction");
    if proposal_action.as_deref() == Some("payment-transfer") {
        return Some("Payment".to_string());
    }
    if proposal_action.as_deref() == Some("asset-exchange") {
        return Some("Exchange".to_string());
    }
    if AssetExchangeInfo::from_proposal(&proposal).is_some() {
        return Some("Exchange".to_string());
    }
    if PaymentInfo::from_proposal(&proposal, Some(&bulk_contract_id)).is_some() {
        return Some("Payment".to_string());
    }
    if let Some(stake) = StakeDelegationInfo::from_proposal(&proposal) {
        let label = match stake.proposal_type.as_str() {
            "stake" => "Earn NEAR",
            "unstake" => "Unstake NEAR",
            "withdraw" => "Withdraw Earnings",
            _ => "Earn NEAR",
        };
        return Some(label.to_string());
    }
    if LockupInfo::from_proposal(&proposal).is_some() {
        return Some("Vesting".to_string());
    }

    if let Some(kind_object) = kind.as_object() {
        if kind_object.contains_key("FunctionCall") {
            return Some("Function Call".to_string());
        }
        if kind_object.contains_key("ChangeConfig") {
            return Some("Update General Settings".to_string());
        }
        if kind_object.keys().any(|k| k.starts_with("ChangePolicy")) {
            return Some("Change Policy".to_string());
        }
        if kind_object.contains_key("UpgradeSelf") || kind_object.contains_key("UpgradeRemote") {
            return Some("Upgrade".to_string());
        }
        return kind_object.keys().next().cloned();
    }

    None
}

pub fn collect_notification_token_ids(event_type: &str, payload: &Value) -> Vec<String> {
    match event_type {
        "payment" => payload
            .get("token_id")
            .and_then(|v| v.as_str())
            .map(|s| vec![s.to_string()])
            .unwrap_or_default(),
        "swap_fulfilled" => {
            let mut ids = Vec::new();
            if let Some(sent) = payload.get("sent_token_id").and_then(|v| v.as_str()) {
                ids.push(sent.to_string());
            }
            if let Some(recv) = payload.get("received_token_id").and_then(|v| v.as_str()) {
                ids.push(recv.to_string());
            }
            ids
        }
        _ => Vec::new(),
    }
}

pub fn decode_notification_content(
    event_type: &str,
    dao_id: &str,
    payload: &Value,
    metadata_map: &HashMap<String, TokenMetadata>,
    frontend_base_url: &str,
) -> DecodedNotificationContent {
    let default_activity_link = format!("{frontend_base_url}/{dao_id}/dashboard/activity");
    let exchange_activity_link =
        format!("{frontend_base_url}/{dao_id}/dashboard/activity?tab=exchange");
    match event_type {
        "add_proposal" => {
            // Public proposals carry the proposer; confidential ones have no
            // public submitter, so the "By:" line is omitted entirely.
            let submitter = payload
                .get("counterparty")
                .and_then(|v| v.as_str())
                .map(format_submitter_for_display);
            let proposal_kind = payload
                .get("proposal_kind")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown");
            if proposal_kind == "Unknown" {
                tracing::warn!(
                    "rendering add_proposal with unknown type for dao={}: payload={}",
                    dao_id,
                    payload
                );
            }
            let dao_esc = escape_telegram_html(dao_id);
            let subtitle = match submitter {
                Some(submitter) => format!(
                    "<b>DAO:</b> {dao_esc}\n<b>By:</b> {}",
                    escape_telegram_html(&submitter)
                ),
                None => format!("<b>DAO:</b> {dao_esc}"),
            };

            let kind_esc = escape_telegram_html(proposal_kind);
            let title = format!("New <b>{kind_esc}</b> proposal");

            DecodedNotificationContent {
                notification_type: proposal_kind.to_string(),
                title,
                subtitle,
                action_link: format!("{frontend_base_url}/{dao_id}/requests"),
                action_text: "View Proposals".to_string(),
            }
        }
        "payment" => {
            let token_id = payload
                .get("token_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let amount_raw = payload
                .get("amount")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let counterparty = payload
                .get("counterparty")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            // Ledger amounts are decimal-adjusted human values; render as-is
            // (same convention the swap branch has always used).
            let amount_abs = amount_raw.trim_start_matches('-');
            let token_meta = token_meta_for_id(token_id, metadata_map);
            let token_symbol = token_meta
                .map(|m| m.symbol.as_str())
                .unwrap_or_else(|| format_token_label(token_id));
            let display_amount = amount_abs.to_string();

            let usd_value = payload
                .get("usd_value")
                .and_then(|v| v.as_str())
                .and_then(|s| BigDecimal::from_str(s).ok())
                .and_then(|v| v.to_f64())
                .map(f64::abs)
                .or_else(|| {
                    let amount = BigDecimal::from_str(amount_abs)
                        .ok()
                        .and_then(|v| v.to_f64());
                    let price = token_meta.and_then(|m| m.price);
                    match (amount, price) {
                        (Some(a), Some(p)) => Some(a * p.abs()),
                        _ => None,
                    }
                });

            let display_amount_esc = escape_telegram_html(&display_amount);
            let token_symbol_esc = escape_telegram_html(token_symbol);
            let counterparty_esc = escape_telegram_html(counterparty);
            let mut subtitle =
                format!("{display_amount_esc} {token_symbol_esc} -&gt; {counterparty_esc}");
            if let Some(usd) = usd_value {
                subtitle.push_str(&format!(
                    "\nUSD: {}",
                    escape_telegram_html(&format_usd(usd))
                ));
            }

            let dao_esc = escape_telegram_html(dao_id);
            DecodedNotificationContent {
                notification_type: "Payment".to_string(),
                title: format!("Payment from {dao_esc}"),
                subtitle,
                action_link: default_activity_link,
                action_text: "View Activity".to_string(),
            }
        }
        "swap_fulfilled" => {
            let sent_token = payload
                .get("sent_token_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let sent_amount = payload
                .get("sent_amount")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let recv_token = payload
                .get("received_token_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let recv_amount = payload
                .get("received_amount")
                .and_then(|v| v.as_str())
                .unwrap_or("?");

            let sent_meta = token_meta_for_id(sent_token, metadata_map);
            let recv_meta = token_meta_for_id(recv_token, metadata_map);
            // detected_swaps stores human-readable amounts already; do not apply
            // token decimals conversion again in notification rendering.
            let sent_display = sent_amount.to_string();
            let recv_display = recv_amount.to_string();
            let sent_symbol = sent_meta
                .map(|m| m.symbol.as_str())
                .unwrap_or_else(|| format_token_label(sent_token));
            let recv_symbol = recv_meta
                .map(|m| m.symbol.as_str())
                .unwrap_or_else(|| format_token_label(recv_token));

            let sent_display_esc = escape_telegram_html(&sent_display);
            let sent_symbol_esc = escape_telegram_html(sent_symbol);
            let recv_display_esc = escape_telegram_html(&recv_display);
            let recv_symbol_esc = escape_telegram_html(recv_symbol);
            let dao_esc = escape_telegram_html(dao_id);
            DecodedNotificationContent {
                notification_type: "Swap".to_string(),
                title: "Swap completed".to_string(),
                subtitle: format!(
                    "<b>DAO:</b> {dao_esc}\n{sent_display_esc} {sent_symbol_esc} -&gt; {recv_display_esc} {recv_symbol_esc}"
                ),
                action_link: exchange_activity_link,
                action_text: "View Activity".to_string(),
            }
        }
        _ => DecodedNotificationContent {
            notification_type: event_type.to_string(),
            title: format!(
                "New {} event in {}",
                escape_telegram_html(event_type),
                escape_telegram_html(dao_id)
            ),
            subtitle: String::new(),
            action_link: default_activity_link,
            action_text: "View Activity".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_proposal_kind, collect_notification_token_ids, decode_notification_content,
    };
    use crate::handlers::token::metadata::TokenMetadata;
    use std::collections::HashMap;

    /// Parse the raw add_proposal args JSON (as stored on-chain) and return
    /// the inner proposal object, mirroring what dao_proposals persists.
    fn proposal_from_args(args_json: &str) -> serde_json::Value {
        let args: serde_json::Value = serde_json::from_str(args_json).expect("valid args json");
        args.get("proposal").cloned().unwrap_or(args)
    }

    #[test]
    fn classify_transfer_kind_as_payment() {
        let proposal = serde_json::json!({
            "description": "Pay Alice",
            "kind": {"Transfer": {"receiver_id": "alice.near", "amount": "1", "token_id": "usdc.near"}}
        });
        assert_eq!(
            classify_proposal_kind(&proposal).as_deref(),
            Some("Payment")
        );
    }

    #[test]
    fn classify_change_policy_kind() {
        let proposal = serde_json::json!({
            "description": "* Title: Update Policy",
            "kind": {"ChangePolicyUpdateParameters": {"parameters": {}}}
        });
        assert_eq!(
            classify_proposal_kind(&proposal).as_deref(),
            Some("Change Policy")
        );
    }

    #[test]
    fn classify_real_yurtur_exchange_mt_transfer() {
        let args = r#"{"proposal":{"description":"* Proposal Action: asset-exchange <br>* Notes: **Must be executed before 2026-03-24T12:51:30.813Z** for transferring tokens to 1Click's deposit address for swap execution. <br>* Token In Address: nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near <br>* Token Out Address: nep141:btc.omft.near <br>* Amount In: 102.9 <br>* Amount Out: 0.00144464 <br>* Slippage: 0.5 <br>* Quote Deadline: 2026-03-24T12:51:30.813Z <br>* Time Estimate: 10 seconds <br>* Deposit Address: cab3bb780c77e98eb0d55f9c938302a52afc04d96b6c963fe9c47c5127eea363 <br>* Signature: ed25519:67d7aMJr2cmLJsH45D9LS3qZAsocEHQnWCjEUYPk21YdzXeEDRJA98TrQoZCk2SfadXtAP7Kf9DBYsbaNhmwRsXG","kind":{"FunctionCall":{"receiver_id":"intents.near","actions":[{"method_name":"mt_transfer","args":"eyJyZWNlaXZlcl9pZCI6ImNhYjNiYjc4MGM3N2U5OGViMGQ1NWY5YzkzODMwMmE1MmFmYzA0ZDk2YjZjOTYzZmU5YzQ3YzUxMjdlZWEzNjMiLCJhbW91bnQiOiIxMDI5MDAwMDAiLCJ0b2tlbl9pZCI6Im5lcDE0MTpldGgtMHhhMGI4Njk5MWM2MjE4YjM2YzFkMTlkNGEyZTllYjBjZTM2MDZlYjQ4Lm9tZnQubmVhciJ9","deposit":"1","gas":"150000000000000"}]}}}}"#;
        let proposal = proposal_from_args(args);
        assert_eq!(
            classify_proposal_kind(&proposal).as_deref(),
            Some("Exchange")
        );
    }

    #[test]
    fn classify_real_yurtur_exchange_wrap_near() {
        let args = r#"{"proposal":{"description":"* Proposal Action: asset-exchange <br>* Notes: **Must be executed before 2026-03-17T16:04:14.636Z** for transferring tokens to 1Click's deposit address for swap execution. <br>* Token In Address: near <br>* Token Out Address: nep141:btc.omft.near <br>* Amount In: 150.0 <br>* Amount Out: 0.00287923 <br>* Slippage: 0.5 <br>* Quote Deadline: 2026-03-17T16:04:14.636Z <br>* Time Estimate: 20 seconds <br>* Deposit Address: bd32ed3931fed4e972c91f2c17dc90a9434a7644610679bde60c081d0443f265 <br>* Signature: ed25519:2wPQyFgdMXs1usmWg5qmKQU4HM1FidJkS94RMdwvMM7PeHWhb2ZRrWxRMMMRnbVESG9CT7176CZBg94QPJfN37Gh","kind":{"FunctionCall":{"receiver_id":"wrap.near","actions":[{"method_name":"near_deposit","args":"e30=","deposit":"150000000000000000000000000","gas":"10000000000000"},{"method_name":"ft_transfer","args":"eyJyZWNlaXZlcl9pZCI6ImJkMzJlZDM5MzFmZWQ0ZTk3MmM5MWYyYzE3ZGM5MGE5NDM0YTc2NDQ2MTA2NzliZGU2MGMwODFkMDQ0M2YyNjUiLCJhbW91bnQiOiIxNTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAifQ==","deposit":"1","gas":"150000000000000"}]}}}}"#;
        let proposal = proposal_from_args(args);
        assert_eq!(
            classify_proposal_kind(&proposal).as_deref(),
            Some("Exchange")
        );
    }

    #[test]
    fn classify_payment_transfer_wrap_near_as_payment() {
        let args = r#"{"proposal":{"description":"* Proposal Action: payment-transfer <br>* Notes: treasury payment via intents","kind":{"FunctionCall":{"receiver_id":"wrap.near","actions":[{"method_name":"near_deposit","args":"e30=","deposit":"1000000000000000000000000","gas":"10000000000000"},{"method_name":"ft_transfer","args":"eyJyZWNlaXZlcl9pZCI6ImFiYzEyMyIsImFtb3VudCI6IjEwMDAwMDAwMDAwMDAwMDAwMDAwMDAifQ==","deposit":"1","gas":"150000000000000"}]}}}}"#;
        let proposal = proposal_from_args(args);
        assert_eq!(
            classify_proposal_kind(&proposal).as_deref(),
            Some("Payment")
        );
    }

    #[test]
    fn decode_notification_content_payment_shape() {
        let payload = serde_json::json!({
            "token_id": "intents.near:nep141:usdc.near",
            "amount": "1.2345",
            "counterparty": "bob.near",
            "usd_value": "1.2345"
        });
        let mut metadata = HashMap::new();
        metadata.insert(
            "intents.near:nep141:usdc.near".to_string(),
            TokenMetadata {
                token_id: "intents.near:nep141:usdc.near".to_string(),
                name: "USDC".to_string(),
                symbol: "USDC".to_string(),
                decimals: 6,
                icon: None,
                price: Some(1.0),
                price_updated_at: None,
                network: None,
                chain_name: None,
                chain_icons: None,
            },
        );

        let decoded = decode_notification_content(
            "payment",
            "dao.near",
            &payload,
            &metadata,
            "https://app.trezu.app",
        );
        assert_eq!(decoded.notification_type, "Payment");
        assert_eq!(decoded.title, "Payment from dao.near");
        assert!(decoded.subtitle.contains("1.2345 USDC -&gt; bob.near"));
        assert!(decoded.subtitle.contains("USD: $1.23"));
        assert_eq!(
            decoded.action_link,
            "https://app.trezu.app/dao.near/dashboard/activity"
        );
        assert_eq!(decoded.action_text, "View Activity");
    }

    #[test]
    fn decode_notification_content_payment_usd_falls_back_to_price() {
        let payload = serde_json::json!({
            "token_id": "usdc.near",
            "amount": "50",
            "counterparty": "bob.near"
        });
        let mut metadata = HashMap::new();
        metadata.insert(
            "usdc.near".to_string(),
            TokenMetadata {
                token_id: "usdc.near".to_string(),
                name: "USDC".to_string(),
                symbol: "USDC".to_string(),
                decimals: 6,
                icon: None,
                price: Some(1.0),
                price_updated_at: None,
                network: None,
                chain_name: None,
                chain_icons: None,
            },
        );

        let decoded = decode_notification_content(
            "payment",
            "dao.near",
            &payload,
            &metadata,
            "https://app.trezu.app",
        );
        assert!(decoded.subtitle.contains("50 USDC -&gt; bob.near"));
        assert!(decoded.subtitle.contains("USD: $50"));
    }

    #[test]
    fn collect_notification_token_ids_swap() {
        let payload = serde_json::json!({
            "sent_token_id": "near",
            "received_token_id": "intents.near:nep141:usdc.near"
        });
        let ids = collect_notification_token_ids("swap_fulfilled", &payload);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"near".to_string()));
        assert!(ids.contains(&"intents.near:nep141:usdc.near".to_string()));
    }

    #[test]
    fn decode_notification_content_swap_uses_human_amounts_without_rescaling() {
        let payload = serde_json::json!({
            "sent_token_id": "intents.near:nep141:usdc.near",
            "sent_amount": "40",
            "received_token_id": "intents.near:nep141:btc.omft.near",
            "received_amount": "0.00061982"
        });

        let mut metadata = HashMap::new();
        metadata.insert(
            "intents.near:nep141:usdc.near".to_string(),
            TokenMetadata {
                token_id: "intents.near:nep141:usdc.near".to_string(),
                name: "USDC".to_string(),
                symbol: "USDC".to_string(),
                decimals: 6,
                icon: None,
                price: Some(1.0),
                price_updated_at: None,
                network: None,
                chain_name: None,
                chain_icons: None,
            },
        );
        metadata.insert(
            "intents.near:nep141:btc.omft.near".to_string(),
            TokenMetadata {
                token_id: "intents.near:nep141:btc.omft.near".to_string(),
                name: "BTC".to_string(),
                symbol: "BTC".to_string(),
                decimals: 8,
                icon: None,
                price: Some(60000.0),
                price_updated_at: None,
                network: None,
                chain_name: None,
                chain_icons: None,
            },
        );

        let decoded = decode_notification_content(
            "swap_fulfilled",
            "trezu-demo.sputnik-dao.near",
            &payload,
            &metadata,
            "https://app.trezu.app",
        );

        assert_eq!(decoded.notification_type, "Swap");
        assert_eq!(decoded.title, "Swap completed");
        assert_eq!(
            decoded.subtitle,
            "<b>DAO:</b> trezu-demo.sputnik-dao.near\n40 USDC -&gt; 0.00061982 BTC"
        );
        assert_eq!(
            decoded.action_link,
            "https://app.trezu.app/trezu-demo.sputnik-dao.near/dashboard/activity?tab=exchange"
        );
        assert_eq!(decoded.action_text, "View Activity");
    }

    #[test]
    fn decode_notification_content_add_proposal_title_and_notes() {
        let payload = serde_json::json!({
            "counterparty": "yurtur.near",
            "proposal_kind": "Change Policy",
            "description": "* Title: Update Policy <br>* Notes: **Must be executed before 2026-03-24T12:51:30.813Z** <br>* Summary: reduced bonds"
        });

        let decoded = decode_notification_content(
            "add_proposal",
            "yurtur-treasury.sputnik-dao.near",
            &payload,
            &HashMap::new(),
            "https://app.trezu.app",
        );

        assert_eq!(decoded.title, "New <b>Change Policy</b> proposal");
        assert!(
            decoded
                .subtitle
                .contains("<b>DAO:</b> yurtur-treasury.sputnik-dao.near")
        );
        assert!(decoded.subtitle.contains("<b>By:</b> yurtur.near"));
        assert_eq!(
            decoded.action_link,
            "https://app.trezu.app/yurtur-treasury.sputnik-dao.near/requests"
        );
        assert_eq!(decoded.action_text, "View Proposals");
    }

    #[test]
    fn decode_notification_content_add_proposal_without_submitter() {
        let payload = serde_json::json!({
            "proposal_kind": "Payment",
            "description": "confidential payout"
        });

        let decoded = decode_notification_content(
            "add_proposal",
            "conf.sputnik-dao.near",
            &payload,
            &HashMap::new(),
            "https://app.trezu.app",
        );

        assert_eq!(decoded.title, "New <b>Payment</b> proposal");
        assert_eq!(decoded.subtitle, "<b>DAO:</b> conf.sputnik-dao.near");
    }
}
