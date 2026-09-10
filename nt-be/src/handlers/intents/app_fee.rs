use serde_json::Value;

/// Whether a stored 1Click quote charged our injected app fee.
///
/// Fees live on `quoteRequest.appFees`. `None` means that array is missing
/// (older swaps always charged). An empty array or a single protocol-fee
/// entry means we did not inject; more than one entry means we did.
pub fn stored_has_app_fee(quote: Option<&Value>) -> Option<bool> {
    let fees = quote_request(quote?)?.get("appFees")?.as_array()?;
    Some(fees.len() > 1)
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

    #[test]
    fn older_quotes_without_app_fees_are_unknown() {
        assert_eq!(stored_has_app_fee(None), None);
        assert_eq!(stored_has_app_fee(Some(&json!({}))), None);
    }

    #[test]
    fn empty_app_fees_is_not_our_app_fee() {
        let quote = json!({
            "quoteRequest": { "appFees": [] }
        });
        assert_eq!(stored_has_app_fee(Some(&quote)), Some(false));
    }

    #[test]
    fn protocol_fee_only_is_not_our_app_fee() {
        let quote = json!({
            "quoteRequest": {
                "appFees": [{
                    "fee": 1,
                    "limitOrderId": null,
                    "recipient": "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd"
                }]
            }
        });
        assert_eq!(stored_has_app_fee(Some(&quote)), Some(false));
    }

    #[test]
    fn injected_fees_plus_protocol_fee_is_our_app_fee() {
        let quote = json!({
            "quoteRequest": {
                "appFees": [
                    { "fee": 18, "recipient": "trezu.sputnik-dao.near" },
                    { "fee": 18, "recipient": "5880ad2b" }
                ]
            }
        });
        assert_eq!(stored_has_app_fee(Some(&quote)), Some(true));
    }

    #[test]
    fn reads_quote_request_out_of_the_public_status_envelope() {
        let quote = json!({
            "status": {
                "quoteResponse": {
                    "quoteRequest": {
                        "appFees": [
                            { "fee": 18, "recipient": "trezu.sputnik-dao.near" },
                            { "fee": 18, "recipient": "5880ad2b" }
                        ]
                    }
                }
            }
        });
        assert_eq!(stored_has_app_fee(Some(&quote)), Some(true));
    }
}
