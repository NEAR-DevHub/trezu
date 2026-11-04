//! The bridge floor for a token: a dry `FLEX_INPUT` quote whose
//! `minAmountIn` is the least 1Click will bridge. The quote is never funded.

use std::sync::Arc;

use chrono::{Duration, Utc};
use reqwest::StatusCode;

use crate::AppState;
use crate::handlers::intents::oneclick::OneClickClient;
use crate::utils::url::api_url_or_500;

/// Deadline given to the dry 1Click quote that probes a token's bridge
/// minimum; the probe quote is never funded.
const MIN_PROBE_QUOTE_VALIDITY_DAYS: i64 = 14;

/// Matches near.com confidential deposit slippage (0.1% → 10 bips).
const CONFIDENTIAL_DEPOSIT_SLIPPAGE_TOLERANCE: u32 = 10;

/// near.com credits NEAR deposited on Hyperliquid as `nep141:wrap.near`.
const HYPERCORE_NEAR_ASSET_ID: &str = "1cs_v1:hypercore:hip1:0x20b8c9d2f022ffd2aea4f7962b7b1d8b";
const NEAR_HELD_ASSET_ID: &str = "nep141:wrap.near";

/// Asset a confidential deposit is credited as. The depositor sends `token_id`.
/// NEAR on Hyperliquid is the one route near.com settles into held NEAR.
pub(super) fn confidential_deposit_destination_asset(token_id: &str) -> &str {
    if token_id == HYPERCORE_NEAR_ASSET_ID {
        NEAR_HELD_ASSET_ID
    } else {
        token_id
    }
}

/// One 1Click confidential deposit quote attempt loop: `FLEX_INPUT` with the
/// `INTENTS` deposit type crediting the DAO's confidential balance. The
/// FE-supplied `amount` is a probe; when 1Click rejects it as below the
/// bridge floor, the quote is retried at the floor from the error (or 10x).
/// Returns the `quote` object. `dry` quotes carry no deposit address.
async fn mint_confidential_deposit_quote(
    state: &Arc<AppState>,
    account_id: &str,
    token_id: &str,
    mut amount: u128,
    deadline: &str,
    dry: bool,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let url = api_url_or_500(&state.env_vars.confidential_api_url, "v0/quote")?;
    if amount == 0 {
        amount = 1;
    }
    let mut last_error = String::new();

    for attempt in 0..3 {
        let quote_body = serde_json::json!({
            "dry": dry,
            "swapType": "FLEX_INPUT",
            "slippageTolerance": CONFIDENTIAL_DEPOSIT_SLIPPAGE_TOLERANCE,
            "originAsset": token_id,
            "depositType": "INTENTS",
            "destinationAsset": confidential_deposit_destination_asset(token_id),
            "amount": amount.to_string(),
            "refundTo": account_id,
            "refundType": "CONFIDENTIAL_INTENTS",
            "recipient": account_id,
            "recipientType": "CONFIDENTIAL_INTENTS",
            "deadline": deadline,
            "quoteWaitingTimeMs": 5000,
        });

        // The app key suffices for a dry probe; no DAO JWT is needed.
        match OneClickClient::new(state)
            .post(url.clone(), &quote_body, None)
            .await
        {
            Ok(mut response_body) => {
                return match response_body.get_mut("quote") {
                    Some(quote) => Ok(quote.take()),
                    None => Err((
                        StatusCode::BAD_GATEWAY,
                        "Confidential quote missing quote object".to_string(),
                    )),
                };
            }
            Err((status, msg)) => {
                last_error = msg.clone();
                let is_amount_error = msg.to_lowercase().contains("amount")
                    || msg.to_lowercase().contains("too low")
                    || msg.to_lowercase().contains("minimum");
                if !is_amount_error || attempt == 2 {
                    return Err((status, msg));
                }
                let next_amount = parse_bridge_minimum_hint(&msg)
                    .filter(|n| *n > amount)
                    .unwrap_or_else(|| amount.saturating_mul(10).max(10));
                tracing::info!(
                    "Quote amount {} too low (attempt {}), retrying with {}",
                    amount,
                    attempt + 1,
                    next_amount
                );
                amount = next_amount;
            }
        }
    }

    Err((StatusCode::BAD_GATEWAY, last_error))
}

/// 1Click's bridge floor for the token (`quote.minAmountIn`), the FE minimum.
fn quote_min_amount_in(quote: &serde_json::Value) -> Result<String, (StatusCode, String)> {
    quote
        .get("minAmountIn")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                "Confidential quote did not return minAmountIn".to_string(),
            )
        })
}

/// Confidential treasuries: the DAO's long-lived 1Click deposit address set,
/// selected by chain. No expiry; the address takes any number of deposits.
/// `min_amount` comes from a dry quote probe, which is where 1Click reports
/// the bridge floor.
/// Parse `try at least N` from 1Click bridge-floor errors.
/// Searches and slices the lowercased string so non-ASCII before the marker
/// cannot shift the byte offset relative to the original message.
fn parse_bridge_minimum_hint(msg: &str) -> Option<u128> {
    let lower = msg.to_lowercase();
    let marker = "try at least ";
    let idx = lower.find(marker)?;
    let rest = lower.get(idx + marker.len()..)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok().filter(|n| *n > 0)
}

/// The floor for `token_id`, or `None` when the probe fails: the address
/// is still served, the floor is a hint for the payer.
pub(super) async fn bridge_minimum(
    state: &Arc<AppState>,
    dao_id: &str,
    token_id: &str,
    amount: u128,
) -> Option<String> {
    let probe_deadline = (Utc::now() + Duration::days(MIN_PROBE_QUOTE_VALIDITY_DAYS))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    match mint_confidential_deposit_quote(state, dao_id, token_id, amount, &probe_deadline, true)
        .await
    {
        Ok(quote) => quote_min_amount_in(&quote).ok(),
        Err((status, message)) => {
            tracing::warn!(
                dao_id,
                token_id,
                %status,
                "bridge floor probe failed; serving reusable address without a minimum: {message}"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypercore_near_id_is_in_the_vendored_catalog() {
        use crate::constants::intents_tokens::get_defuse_tokens_map;

        assert!(
            get_defuse_tokens_map().contains_key(HYPERCORE_NEAR_ASSET_ID),
            "HYPERCORE_NEAR_ASSET_ID drifted from nearcom-tokens.json"
        );
    }

    #[test]
    fn hyperliquid_near_deposit_credits_wrap_near() {
        assert_eq!(
            confidential_deposit_destination_asset(HYPERCORE_NEAR_ASSET_ID),
            NEAR_HELD_ASSET_ID
        );
        assert_eq!(
            confidential_deposit_destination_asset("1cs_v1:near:nep141:zec.omft.near"),
            "1cs_v1:near:nep141:zec.omft.near"
        );
        assert_eq!(
            confidential_deposit_destination_asset(
                "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG"
            ),
            "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG"
        );
    }

    #[test]
    fn parse_bridge_minimum_hint_reads_try_at_least() {
        assert_eq!(
            parse_bridge_minimum_hint("Amount is too low for bridge, try at least 324044069993519"),
            Some(324044069993519)
        );
        assert_eq!(parse_bridge_minimum_hint("tokenIn is not valid"), None);
        assert_eq!(parse_bridge_minimum_hint("try at least 0"), None);
    }
}
