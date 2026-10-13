use serde_json::Value;

/// Whether a stored 1Click quote charged our injected app fee.
///
/// Prefer the `hasAppFee` flag stamped on the quote response when the
/// proposal was created. Otherwise look for our configured recipient in
/// `quoteRequest.appFees` — 1Click appends its own protocol fee and later
/// quotes can include more partners, so array length is not a signal.
/// `None` means the fee list is missing (older swaps always charged).
pub fn stored_has_app_fee(quote: Option<&Value>) -> Option<bool> {
    has_our_app_fee(quote, &our_app_fee_recipient())
}

fn our_app_fee_recipient() -> String {
    std::env::var("ONECLICK_APP_FEE_RECIPIENT")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "trezu.sputnik-dao.near".to_string())
}

fn has_our_app_fee(quote: Option<&Value>, our_recipient: &str) -> Option<bool> {
    let quote = quote?;
    if let Some(flag) = stamped_has_app_fee(quote) {
        return Some(flag);
    }
    let fees = quote_request(quote)?.get("appFees")?.as_array()?;
    Some(
        fees.iter()
            .any(|fee| recipient_matches(fee, our_recipient)),
    )
}

fn stamped_has_app_fee(value: &Value) -> Option<bool> {
    value
        .get("hasAppFee")
        .and_then(Value::as_bool)
        .or_else(|| {
            value
                .pointer("/status/quoteResponse/hasAppFee")
                .and_then(Value::as_bool)
        })
}

fn recipient_matches(fee: &Value, our_recipient: &str) -> bool {
    fee.get("recipient")
        .and_then(Value::as_str)
        .is_some_and(|recipient| recipient.eq_ignore_ascii_case(our_recipient))
}

/// Confidential stores the 1Click quote as-is. Public history wraps it in
/// `{ status: { quoteResponse } }`.
fn quote_request(value: &Value) -> Option<&Value> {
    value
        .get("quoteRequest")
        .or_else(|| value.pointer("/status/quoteResponse/quoteRequest"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const OURS: &str = "trezu.sputnik-dao.near";
    const PROTOCOL: &str = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";

    #[test]
    fn older_quotes_without_app_fees_are_unknown() {
        assert_eq!(has_our_app_fee(None, OURS), None);
        assert_eq!(has_our_app_fee(Some(&json!({})), OURS), None);
    }

    #[test]
    fn empty_app_fees_is_not_our_app_fee() {
        let quote = json!({
            "quoteRequest": { "appFees": [] }
        });
        assert_eq!(has_our_app_fee(Some(&quote), OURS), Some(false));
    }

    #[test]
    fn protocol_fee_only_is_not_our_app_fee() {
        let quote = json!({
            "quoteRequest": {
                "appFees": [{
                    "fee": 1,
                    "limitOrderId": null,
                    "recipient": PROTOCOL
                }]
            }
        });
        assert_eq!(has_our_app_fee(Some(&quote), OURS), Some(false));
    }

    #[test]
    fn our_recipient_alone_is_our_app_fee() {
        let quote = json!({
            "quoteRequest": {
                "appFees": [{ "fee": 18, "recipient": OURS }]
            }
        });
        assert_eq!(has_our_app_fee(Some(&quote), OURS), Some(true));
    }

    #[test]
    fn our_recipient_among_several_fees_is_our_app_fee() {
        let quote = json!({
            "quoteRequest": {
                "appFees": [
                    { "fee": 18, "recipient": OURS },
                    { "fee": 18, "recipient": PROTOCOL },
                    { "fee": 5, "recipient": "partner.near" }
                ]
            }
        });
        assert_eq!(has_our_app_fee(Some(&quote), OURS), Some(true));
    }

    #[test]
    fn several_other_fees_without_us_is_not_our_app_fee() {
        let quote = json!({
            "quoteRequest": {
                "appFees": [
                    { "fee": 18, "recipient": PROTOCOL },
                    { "fee": 5, "recipient": "partner.near" }
                ]
            }
        });
        assert_eq!(has_our_app_fee(Some(&quote), OURS), Some(false));
    }

    #[test]
    fn stamped_has_app_fee_on_the_quote_wins() {
        let charged = json!({
            "hasAppFee": true,
            "quoteRequest": { "appFees": [] }
        });
        assert_eq!(has_our_app_fee(Some(&charged), OURS), Some(true));

        let skipped = json!({
            "hasAppFee": false,
            "quoteRequest": {
                "appFees": [{ "fee": 18, "recipient": OURS }]
            }
        });
        assert_eq!(has_our_app_fee(Some(&skipped), OURS), Some(false));
    }

    #[test]
    fn reads_quote_request_out_of_the_public_status_envelope() {
        let quote = json!({
            "status": {
                "quoteResponse": {
                    "hasAppFee": true,
                    "quoteRequest": {
                        "appFees": [
                            { "fee": 18, "recipient": OURS },
                            { "fee": 18, "recipient": PROTOCOL }
                        ]
                    }
                }
            }
        });
        assert_eq!(has_our_app_fee(Some(&quote), OURS), Some(true));
    }
}
