//! Research script: authenticate with 1Click API, get a confidential shield quote,
//! generate an intent, and capture all API responses for use as test mocks.
//!
//! Run with:
//!   cargo run --example test_generate_intent
//!
//! Required env vars (from .env in repo root):
//!   PETERSALOMONSEN_DEV - ed25519 secret key for petersalomonsendev.near
//!   ONECLICK_API_KEY - 1Click API partner key (from defuse.txt)
//!
//! Optional:
//!   ONECLICK_ACCESS_TOKEN - skip auth if you already have a valid token

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use near_api::{
    NearGas, NearToken, Transaction,
    types::{Action, transaction::actions::FunctionCallAction},
};
use serde_json::Value;

const ONECLICK_API_URL: &str = "https://1click-test.chaindefuser.com";
const ACCOUNT_ID: &str = "petersalomonsendev.near";
const INTENTS_CONTRACT: &str = "intents.near";

/// NEP-413 payload struct, matching near-cli-rs implementation.
/// Uses borsh serialization with fixed-size nonce.
#[derive(borsh::BorshSerialize)]
struct NEP413Payload {
    message: String,
    nonce: [u8; 32],
    recipient: String,
    callback_url: Option<String>,
}

/// Build a versioned nonce as expected by the intents.near contract.
///
/// Format (32 bytes total):
///   [4 bytes magic: 56 28 F6 C6]
///   [1 byte version: 0]
///   [4 bytes salt from intents.near::current_salt()]
///   [8 bytes deadline in nanoseconds, LE]
///   [15 bytes random]
fn build_versioned_nonce(salt: &[u8; 4], deadline: &chrono::DateTime<chrono::Utc>) -> [u8; 32] {
    let magic: [u8; 4] = [0x56, 0x28, 0xF6, 0xC6];
    let version: u8 = 0;
    let deadline_ns: u64 = (deadline.timestamp_millis() as u64) * 1_000_000;

    // The 15-byte "random" field is actually timestamped:
    // first 8 bytes = current time in nanoseconds (LE) (from createTimestampedNonceBytes)
    // last 7 bytes = random
    let now_ns: u64 = (chrono::Utc::now().timestamp_millis() as u64) * 1_000_000;
    let random_tail: [u8; 7] = rand::random();

    let mut nonce = [0u8; 32];
    nonce[0..4].copy_from_slice(&magic);
    nonce[4] = version;
    nonce[5..9].copy_from_slice(salt);
    nonce[9..17].copy_from_slice(&deadline_ns.to_le_bytes());
    nonce[17..25].copy_from_slice(&now_ns.to_le_bytes());
    nonce[25..32].copy_from_slice(&random_tail);
    nonce
}

/// Fetch the current salt from intents.near contract
async fn fetch_intents_salt() -> [u8; 4] {
    let client = reqwest::Client::new();
    let args_b64 = BASE64.encode("{}");

    let response = client
        .post("https://rpc.mainnet.near.org")
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "optimistic",
                "account_id": INTENTS_CONTRACT,
                "method_name": "current_salt",
                "args_base64": args_b64,
            }
        }))
        .send()
        .await
        .expect("RPC call failed");

    let data: Value = response.json().await.expect("Invalid JSON");
    let result_bytes: Vec<u8> = data["result"]["result"]
        .as_array()
        .expect("result should be array")
        .iter()
        .map(|v| v.as_u64().unwrap() as u8)
        .collect();
    // Result is a JSON string like "01abcdef" (hex-encoded 4 bytes)
    let hex_str = String::from_utf8(result_bytes).unwrap();
    let hex_str = hex_str.trim_matches('"');
    let salt_bytes = hex::decode(hex_str).expect("Invalid hex salt");
    assert_eq!(salt_bytes.len(), 4, "Salt must be 4 bytes");
    salt_bytes.try_into().unwrap()
}

/// Sign a NEP-413 message using near-crypto (same as near-cli-rs).
/// Returns (signature_str, public_key_str) in NEAR format ("ed25519:...")
fn sign_nep413_message(
    secret_key_str: &str,
    message: &str,
    nonce: &[u8; 32],
    recipient: &str,
) -> (String, String) {
    let secret_key: near_crypto::SecretKey = secret_key_str.parse().expect("Invalid secret key");
    let public_key = secret_key.public_key();

    let payload = NEP413Payload {
        message: message.to_string(),
        nonce: *nonce,
        recipient: recipient.to_string(),
        callback_url: None,
    };

    // NEP-413 signing: sha256(tag_le_bytes + borsh(payload)), then ed25519 sign
    const NEP413_PREFIX: u32 = (1u32 << 31) + 413;
    let mut bytes = NEP413_PREFIX.to_le_bytes().to_vec();
    borsh::to_writer(&mut bytes, &payload).expect("Borsh serialization failed");

    use sha2::Digest;
    let hash = sha2::Sha256::digest(&bytes);
    let signature = secret_key.sign(&hash);

    (signature.to_string(), public_key.to_string())
}

/// Check if the public key is registered on intents.near
async fn check_public_key_registered(public_key: &str) -> bool {
    let client = reqwest::Client::new();
    let args = serde_json::json!({
        "account_id": ACCOUNT_ID,
        "public_key": public_key,
    });
    let args_b64 = BASE64.encode(serde_json::to_string(&args).unwrap());

    let response = client
        .post("https://rpc.mainnet.near.org")
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": INTENTS_CONTRACT,
                "method_name": "has_public_key",
                "args_base64": args_b64,
            }
        }))
        .send()
        .await
        .expect("RPC call failed");

    let data: Value = response.json().await.expect("Invalid JSON");
    let result_bytes: Vec<u8> = data["result"]["result"]
        .as_array()
        .expect("result should be array")
        .iter()
        .map(|v| v.as_u64().unwrap() as u8)
        .collect();
    let result_str = String::from_utf8(result_bytes).unwrap();
    result_str == "true"
}

/// Register public key on intents.near via add_public_key function call
async fn register_public_key(secret_key_str: &str, public_key: &str) {
    println!("Registering public key on intents.near...");

    let near_secret: near_api::SecretKey = secret_key_str.parse().expect("Invalid secret key");
    let signer_id: near_api::AccountId = ACCOUNT_ID.parse().expect("Invalid account ID");

    let args = serde_json::json!({ "public_key": public_key });

    let tx = Transaction::construct(
        signer_id.clone(),
        INTENTS_CONTRACT.parse().unwrap(),
    )
    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: "add_public_key".to_string(),
        args: serde_json::to_vec(&args).unwrap().into(),
        gas: NearGas::from_tgas(5),
        deposit: NearToken::from_yoctonear(1),
    })))
    .with_signer(
        near_api::signer::Signer::new(near_api::signer::secret_key::SecretKeySigner::new(near_secret)).unwrap(),
    )
    .send_to(&near_api::NetworkConfig::mainnet())
    .await;

    match tx {
        Ok(result) => {
            println!("add_public_key tx succeeded!");
            println!(
                "Result: {:?}\n",
                result
            );
        }
        Err(e) => {
            eprintln!("add_public_key tx failed: {:?}", e);
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::from_filename("../.env").ok();
    dotenvy::from_filename(".env").ok();

    let secret_key = std::env::var("PETERSALOMONSEN_DEV")
        .expect("PETERSALOMONSEN_DEV must be set");
    let api_key = std::env::var("ONECLICK_API_KEY")
        .expect("ONECLICK_API_KEY must be set");
    let existing_token = std::env::var("ONECLICK_ACCESS_TOKEN").ok();

    let client = reqwest::Client::new();

    // Get public key from secret key
    let parsed_key: near_crypto::SecretKey = secret_key.parse().expect("Invalid secret key");
    let public_key_str = parsed_key.public_key().to_string();

    // =============================================
    // Step -1: Ensure public key is registered on intents.near
    // =============================================
    println!("=== Checking if public key is registered on intents.near ===\n");
    let is_registered = check_public_key_registered(&public_key_str).await;
    println!("Public key {} registered: {}\n", public_key_str, is_registered);

    if !is_registered {
        register_public_key(&secret_key, &public_key_str).await;
        // Verify registration
        let registered_now = check_public_key_registered(&public_key_str).await;
        println!("After registration: {}\n", registered_now);
        if !registered_now {
            eprintln!("Failed to register public key. Aborting.");
            return Ok(());
        }
    }

    // =============================================
    // Step 0: Authenticate (if no existing token)
    // =============================================
    let access_token = if let Some(token) = existing_token {
        println!("=== Using existing access token ===\n");
        token
    } else {
        println!("=== Step 0: Authenticating with 1Click API ===\n");

        // Fetch salt from intents.near contract (required for versioned nonce)
        let salt = fetch_intents_salt().await;
        println!("Contract salt: {}\n", hex::encode(salt));

        // Create a verification message (empty intents, just proves identity)
        let deadline = chrono::Utc::now() + chrono::Duration::minutes(5);
        let nonce = build_versioned_nonce(&salt, &deadline);
        let nonce_b64 = BASE64.encode(nonce);

        let message = serde_json::json!({
            "deadline": deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            "intents": [],
            "signer_id": ACCOUNT_ID,
        })
        .to_string();

        let (signature, public_key) =
            sign_nep413_message(&secret_key, &message, &nonce, "intents.near");

        println!("Message: {}", message);
        println!("Nonce (b64): {}", nonce_b64);
        println!("Signature: {}", signature);
        println!("Public key: {}\n", public_key);

        // Build the MultiPayload for auth
        let auth_body = serde_json::json!({
            "signedData": {
                "standard": "nep413",
                "payload": {
                    "message": message,
                    "nonce": nonce_b64,
                    "recipient": "intents.near",
                },
                "public_key": public_key,
                "signature": signature,
            }
        });

        println!(
            "Auth request:\n{}\n",
            serde_json::to_string_pretty(&auth_body)?
        );

        let auth_response = client
            .post(format!("{}/v0/auth/authenticate", ONECLICK_API_URL))
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .json(&auth_body)
            .send()
            .await?;

        let auth_status = auth_response.status();
        let auth_data: Value = auth_response.json().await?;

        println!(
            "Auth response ({}):\n{}\n",
            auth_status,
            serde_json::to_string_pretty(&auth_data)?
        );

        // Save auth response
        std::fs::create_dir_all("examples/fixtures").ok();
        std::fs::write(
            "examples/fixtures/auth_response.json",
            serde_json::to_string_pretty(&auth_data)?,
        )
        .ok();

        if !auth_status.is_success() {
            eprintln!("Authentication failed.");
            return Ok(());
        }

        let token = auth_data
            .get("accessToken")
            .and_then(|v| v.as_str())
            .expect("Auth response should contain accessToken")
            .to_string();

        println!("Got access token (first 50 chars): {}...\n", &token[..50.min(token.len())]);
        token
    };

    // =============================================
    // Step 1: Get a shield quote
    // =============================================
    let deadline = chrono::Utc::now() + chrono::Duration::minutes(10);

    println!("=== Step 1: Getting shield quote ===\n");

    let quote_body = serde_json::json!({
        "dry": false,
        "swapType": "EXACT_INPUT",
        "slippageTolerance": 100,
        "originAsset": "nep141:wrap.near",
        "depositType": "INTENTS",
        "destinationAsset": "nep141:wrap.near",
        "amount": "10000000000000000000000",  // 0.01 wNEAR (small amount)
        "refundTo": ACCOUNT_ID,
        "refundType": "CONFIDENTIAL_INTENTS",
        "recipient": ACCOUNT_ID,
        "recipientType": "CONFIDENTIAL_INTENTS",
        "deadline": deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        "quoteWaitingTimeMs": 5000,
    });

    println!("Request:\n{}\n", serde_json::to_string_pretty(&quote_body)?);

    let quote_response = client
        .post(format!("{}/v0/quote", ONECLICK_API_URL))
        .header("content-type", "application/json")
        .header("x-api-key", &api_key)
        .header("Authorization", format!("Bearer {}", access_token))
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

    // Save quote response
    std::fs::write(
        "examples/fixtures/shield_quote_response.json",
        serde_json::to_string_pretty(&quote_data)?,
    )?;

    if !quote_status.is_success() {
        eprintln!("Quote failed.");
        return Ok(());
    }

    let deposit_address = quote_data
        .get("quote")
        .and_then(|q| q.get("depositAddress"))
        .and_then(|v| v.as_str());

    if let Some(addr) = deposit_address {
        println!("Deposit address (FAR chain hex): {}\n", addr);

        // =============================================
        // Step 2: Generate intent
        // =============================================
        println!("=== Step 2: Generating intent ===\n");

        let generate_body = serde_json::json!({
            "type": "SWAP_TRANSFER",
            "standard": "NEP413",
            "depositAddress": addr,
            "signerId": ACCOUNT_ID,
        });

        println!(
            "Request:\n{}\n",
            serde_json::to_string_pretty(&generate_body)?
        );

        let gen_response = client
            .post(format!("{}/v0/generate-intent", ONECLICK_API_URL))
            .header("content-type", "application/json")
            .header("x-api-key", &api_key)
            .header("Authorization", format!("Bearer {}", access_token))
            .json(&generate_body)
            .send()
            .await?;

        let gen_status = gen_response.status();
        let gen_data: Value = gen_response.json().await?;

        println!(
            "Generate intent response ({}):\n{}\n",
            gen_status,
            serde_json::to_string_pretty(&gen_data)?
        );

        // Save generate-intent response
        std::fs::write(
            "examples/fixtures/generate_intent_response.json",
            serde_json::to_string_pretty(&gen_data)?,
        )?;
    } else {
        println!("No depositAddress in quote response.");
    }

    println!("=== Done! Fixtures saved to examples/fixtures/ ===");
    Ok(())
}
