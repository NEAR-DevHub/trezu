//! Manually submit a pending confidential intent by supplying its Eddsa hash +
//! MPC Ed25519 signature from the CLI. Useful for debugging the
//! submit-intent step in isolation from the DAO-vote relay pipeline.
//!
//! The NEP-413 envelope used for payments mirrors the auth format — an
//! `intents: [...]` array inside a message with `external_app_data.configs[]`
//! — but POSTed to `/v0/submit-intent` so 1Click settles the transfers.
//!
//! Looks up `confidential_intents` by `(dao_id, payload_hash)`, fetches the
//! DAO's derived MPC public key, and POSTs to 1Click. Endpoint defaults to
//! `/v0/submit-intent` (for `payment` / `bulk_payment` rows) but can be
//! overridden with `--auth` to use `/v0/auth/authenticate` (for `auth` rows,
//! or when testing whether a payment payload can be replayed through the auth
//! endpoint).
//!
//! Usage:
//!   cargo run --example submit_pending_intent -- \
//!       <dao_id> <payload_hash_hex> <ed25519_signature> [--auth]
//!
//! Example:
//!   cargo run --example submit_pending_intent -- \
//!       my-dao.sputnik-dao.near \
//!       9f3ab4... \
//!       ed25519:5aK... \
//!
//! Signature formats accepted:
//!   - `ed25519:<base58>` (same shape the relay emits)
//!   - raw base58 (prefix is added)
//!
//! Env: DATABASE_URL, ONECLICK_API_URL (optional, defaults to prod),
//! ONECLICK_API_KEY (optional).

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;

const V1_SIGNER_CONTRACT_ID: &str = "v1.signer";

fn oneclick_url() -> String {
    std::env::var("ONECLICK_API_URL")
        .unwrap_or_else(|_| "https://1click-test.chaindefuser.com".to_string())
}

async fn fetch_mpc_public_key(dao_id: &str) -> Result<String, Box<dyn std::error::Error>> {
    let args = json!({
        "path": dao_id,
        "predecessor": dao_id,
        "domain_id": 1,
    });
    let result = near_api::Contract(V1_SIGNER_CONTRACT_ID.parse()?)
        .call_function("derived_public_key", args)
        .read_only::<String>()
        .fetch_from(&near_api::NetworkConfig::mainnet())
        .await?;
    Ok(result.data)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "Usage: {} <dao_id> <payload_hash_hex> <ed25519_signature> [--auth]",
            args[0]
        );
        std::process::exit(1);
    }
    let dao_id = &args[1];
    let payload_hash = args[2].trim().to_lowercase();
    let signature_raw = args[3].trim().to_string();
    let use_auth_endpoint = args.iter().any(|a| a == "--auth");

    dotenvy::from_filename("../.env").ok();
    dotenvy::from_filename(".env").ok();

    let signature = if signature_raw.starts_with("ed25519:") {
        signature_raw
    } else {
        format!("ed25519:{}", signature_raw)
    };

    // Load the pending intent from DB.
    let db_url = std::env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&db_url)
        .await?;

    let row: Option<(Value, String)> = sqlx::query_as(
        r#"
        SELECT intent_payload, intent_type
        FROM confidential_intents
        WHERE dao_id = $1 AND payload_hash = $2
        "#,
    )
    .bind(dao_id)
    .bind(&payload_hash)
    .fetch_optional(&pool)
    .await?;

    let (intent_payload, intent_type) = match row {
        Some(r) => r,
        None => {
            eprintln!(
                "No confidential_intents row for dao_id={} payload_hash={}",
                dao_id, payload_hash
            );
            std::process::exit(2);
        }
    };

    // /v0/submit-intent needs the DAO's 1Click access token; load it from
    // monitored_accounts (refresh is out-of-scope for this debugging tool —
    // if it's expired, re-run the auth flow).
    let access_token = {
        let tok: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT confidential_access_token FROM monitored_accounts WHERE account_id = $1",
        )
        .bind(dao_id)
        .fetch_optional(&pool)
        .await?;
        match tok.and_then(|(t,)| t) {
            Some(t) => Some(t),
            None => {
                eprintln!(
                    "No confidential_access_token stored for DAO {}; cannot call submit-intent",
                    dao_id
                );
                std::process::exit(4);
            }
        }
    };

    println!(
        "Loaded intent: type={} payload={}",
        intent_type,
        serde_json::to_string_pretty(&intent_payload)?
    );

    let mpc_public_key = fetch_mpc_public_key(dao_id).await?;
    println!("MPC public key: {}", mpc_public_key);

    let client = reqwest::Client::new();
    let api_key = std::env::var("ONECLICK_API_KEY").ok();

    // Two body shapes:
    //  - auth:   { signedData: {...} }                  → /v0/auth/authenticate
    //  - submit: { type:"swap_transfer", signedData }   → /v0/submit-intent
    // Both carry the same NEP-413 `signedData` envelope; the endpoint decides
    // how 1Click interprets it.
    let signed_data = json!({
        "standard": "nep413",
        "payload": intent_payload,
        "public_key": mpc_public_key,
        "signature": signature,
    });

    let (url, body) = if use_auth_endpoint {
        (
            format!("{}/v0/auth/authenticate", oneclick_url()),
            json!({ "signedData": signed_data }),
        )
    } else {
        (
            format!("{}/v0/submit-intent", oneclick_url()),
            json!({
                "signedData": signed_data,
                "type": "swap_transfer",
            }),
        )
    };

    println!("\nPOST {}", url);
    println!("Body: {}", serde_json::to_string_pretty(&body)?);

    let mut req = client.post(&url).header("content-type", "application/json");
    if let Some(k) = &api_key {
        req = req.header("x-api-key", k);
    }
    if let Some(t) = &access_token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    let resp = req.json(&body).send().await?;

    let status = resp.status();
    let resp_body: Value = resp.json().await.unwrap_or_else(|_| json!({}));

    println!(
        "\nResponse {}: {}",
        status,
        serde_json::to_string_pretty(&resp_body)?
    );

    if !status.is_success() {
        std::process::exit(3);
    }
    Ok(())
}
