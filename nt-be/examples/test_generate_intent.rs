//! Integration test for the confidential shield flow against the real 1Click API.
//!
//! Run with: cargo run --example test_generate_intent
//!
//! Discovered from HAR analysis of near.com/transfer/confidential?mode=shield:
//! near.com wraps 1Click API in server actions with a simplified interface.
//! The server action internally builds the full 1Click request and adds
//! CONFIDENTIAL_INTENTS routing. The public 1Click API only accepts
//! ORIGIN_CHAIN, INTENTS for depositType/refundType and
//! DESTINATION_CHAIN, INTENTS for recipientType.
//!
//! For shield (same-token transfer to confidential), near.com's server action
//! likely calls a DIFFERENT internal API or an authenticated endpoint.

use serde_json::Value;

const ONECLICK_API_URL: &str = "https://1click.chaindefuser.com";
const ACCOUNT_ID: &str = "petersalomonsen.near";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let deadline = chrono::Utc::now() + chrono::Duration::minutes(10);

    // Step 1: Get a quote with all required fields
    println!("=== Step 1: Getting quote (INTENTS → INTENTS, same token) ===\n");

    let quote_body = serde_json::json!({
        "dry": false,
        "swapType": "EXACT_INPUT",
        "slippageTolerance": 100,
        "originAsset": "nep141:wrap.near",
        "depositType": "INTENTS",
        "destinationAsset": "nep141:wrap.near",
        "amount": "100000000000000000000000",  // 0.1 wNEAR
        "refundTo": ACCOUNT_ID,
        "refundType": "INTENTS",
        "recipient": ACCOUNT_ID,
        "recipientType": "INTENTS",
        "deadline": deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        "quoteWaitingTimeMs": 5000,
    });

    println!("Request:\n{}\n", serde_json::to_string_pretty(&quote_body)?);

    let quote_response = client
        .post(format!("{}/v0/quote", ONECLICK_API_URL))
        .header("content-type", "application/json")
        .json(&quote_body)
        .send()
        .await?;

    let quote_status = quote_response.status();
    let quote_data: Value = quote_response.json().await?;

    println!(
        "Quote response ({}):\n{}\n",
        quote_status,
        serde_json::to_string_pretty(&quote_data)?
    );

    if !quote_status.is_success() {
        eprintln!("Quote failed.");
        return Ok(());
    }

    let deposit_address = quote_data
        .get("quote")
        .and_then(|q| q.get("depositAddress"))
        .and_then(|v| v.as_str());

    if let Some(addr) = deposit_address {
        println!("Deposit address: {}\n", addr);

        // Step 2: Generate intent
        println!("=== Step 2: Generating intent ===\n");

        let generate_body = serde_json::json!({
            "type": "swap_transfer",
            "depositAddress": addr,
            "signerId": ACCOUNT_ID,
            "standard": "nep413",
        });

        println!("Request:\n{}\n", serde_json::to_string_pretty(&generate_body)?);

        let generate_response = client
            .post(format!("{}/v0/generate-intent", ONECLICK_API_URL))
            .header("content-type", "application/json")
            .json(&generate_body)
            .send()
            .await?;

        let generate_status = generate_response.status();
        let generate_data: Value = generate_response.json().await?;

        println!(
            "Generate intent response ({}):\n{}\n",
            generate_status,
            serde_json::to_string_pretty(&generate_data)?
        );
    } else {
        println!("No depositAddress in response.");
    }

    Ok(())
}
