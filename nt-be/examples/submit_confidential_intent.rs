//! Submit a signed confidential intent using the MPC signature from v1.signer.
//!
//! This script:
//! 1. Registers the MPC-derived public key on intents.near (if not already)
//! 2. Gets a real shield quote from 1Click API (via auth flow)
//! 3. Generates the intent payload
//! 4. Creates a DAO proposal to sign via v1.signer
//! 5. Approves the proposal to get the MPC signature
//! 6. Submits the signed intent to 1Click API
//!
//! Run with: cargo run --example submit_confidential_intent

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use near_api::{
    NearGas, NearToken, Transaction,
    types::{Action, transaction::actions::FunctionCallAction},
};
use serde_json::{Value, json};

const ACCOUNT_ID: &str = "petersalomonsendev.near";
const DAO_ID: &str = "petersalomonsendev.sputnik-dao.near";
const MPC_PUBLIC_KEY: &str = "ed25519:7pPtVUyLDRXvzkgAUtfGeUK9ZWaSWd256tSgvazfZKZg";

/// NEP-413 payload for borsh serialization
#[derive(borsh::BorshSerialize)]
struct NEP413Payload {
    message: String,
    nonce: [u8; 32],
    recipient: String,
    callback_url: Option<String>,
}

/// Check if a public key is registered on intents.near for the DAO
async fn check_public_key_registered(account_id: &str, public_key: &str) -> bool {
    let client = reqwest::Client::new();
    let args = json!({ "account_id": account_id, "public_key": public_key });
    let args_b64 = BASE64.encode(serde_json::to_string(&args).unwrap());

    let response = client
        .post("https://rpc.mainnet.near.org")
        .json(&json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": "intents.near",
                "method_name": "has_public_key",
                "args_base64": args_b64,
            }
        }))
        .send().await.unwrap()
        .json::<Value>().await.unwrap();

    let result_bytes: Vec<u8> = response["result"]["result"]
        .as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap() as u8).collect();
    String::from_utf8(result_bytes).unwrap() == "true"
}

/// Register a public key on intents.near via the DAO (add_proposal + act_proposal)
async fn register_public_key_via_dao(secret_key_str: &str, public_key: &str) {
    let near_secret: near_api::SecretKey = secret_key_str.parse().unwrap();

    // Build a proposal to call intents.near::add_public_key
    let add_pk_args = json!({ "public_key": public_key });
    let proposal = json!({
        "proposal": {
            "description": "Register MPC public key on intents.near for confidential transfers",
            "kind": {
                "FunctionCall": {
                    "receiver_id": "intents.near",
                    "actions": [{
                        "method_name": "add_public_key",
                        "args": BASE64.encode(serde_json::to_string(&add_pk_args).unwrap().as_bytes()),
                        "deposit": "1",
                        "gas": "10000000000000",
                    }],
                }
            }
        }
    });

    println!("  Creating add_public_key proposal...");
    let tx = Transaction::construct(
        ACCOUNT_ID.parse().unwrap(), DAO_ID.parse().unwrap(),
    )
    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: "add_proposal".to_string(),
        args: serde_json::to_vec(&proposal).unwrap().into(),
        gas: NearGas::from_tgas(100),
        deposit: NearToken::from_yoctonear(0),
    })))
    .with_signer(near_api::signer::Signer::new(
        near_api::signer::secret_key::SecretKeySigner::new(near_secret.clone()),
    ).unwrap())
    .send_to(&near_api::NetworkConfig::mainnet())
    .await.expect("add_proposal failed");

    // Get the last proposal ID
    let client = reqwest::Client::new();
    let resp = client
        .post("https://rpc.mainnet.near.org")
        .json(&json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": DAO_ID,
                "method_name": "get_last_proposal_id",
                "args_base64": BASE64.encode("{}"),
            }
        }))
        .send().await.unwrap()
        .json::<Value>().await.unwrap();

    let result_bytes: Vec<u8> = resp["result"]["result"]
        .as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap() as u8).collect();
    let last_id: u64 = String::from_utf8(result_bytes).unwrap().parse().unwrap();
    let proposal_id = last_id - 1; // The one we just created

    println!("  Proposal ID: {}", proposal_id);

    // Fetch the proposal kind for act_proposal
    let resp = client
        .post("https://rpc.mainnet.near.org")
        .json(&json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": DAO_ID,
                "method_name": "get_proposal",
                "args_base64": BASE64.encode(json!({"id": proposal_id}).to_string()),
            }
        }))
        .send().await.unwrap()
        .json::<Value>().await.unwrap();

    let result_bytes: Vec<u8> = resp["result"]["result"]
        .as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap() as u8).collect();
    let proposal_data: Value = serde_json::from_slice(&result_bytes).unwrap();
    let kind = &proposal_data["kind"];

    println!("  Approving proposal...");
    let tx = Transaction::construct(
        ACCOUNT_ID.parse().unwrap(), DAO_ID.parse().unwrap(),
    )
    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: "act_proposal".to_string(),
        args: serde_json::to_vec(&json!({
            "id": proposal_id,
            "action": "VoteApprove",
            "proposal": kind,
        })).unwrap().into(),
        gas: NearGas::from_tgas(100),
        deposit: NearToken::from_yoctonear(0),
    })))
    .with_signer(near_api::signer::Signer::new(
        near_api::signer::secret_key::SecretKeySigner::new(near_secret),
    ).unwrap())
    .send_to(&near_api::NetworkConfig::mainnet())
    .await.expect("act_proposal failed");

    println!("  Public key registered on intents.near!");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::from_filename("../.env").ok();
    dotenvy::from_filename(".env").ok();

    let secret_key_str = std::env::var("PETERSALOMONSEN_DEV")?;
    let near_secret: near_api::SecretKey = secret_key_str.parse()?;

    // =============================================
    // Step 1: Register MPC public key on intents.near
    // =============================================
    println!("=== Step 1: Check/register MPC public key on intents.near ===\n");

    let is_registered = check_public_key_registered(DAO_ID, MPC_PUBLIC_KEY).await;
    println!("MPC key {} registered on intents.near for {}: {}\n",
        MPC_PUBLIC_KEY, DAO_ID, is_registered);

    if !is_registered {
        register_public_key_via_dao(&secret_key_str, MPC_PUBLIC_KEY).await;
        // Verify
        let now_registered = check_public_key_registered(DAO_ID, MPC_PUBLIC_KEY).await;
        println!("  After registration: {}\n", now_registered);
        if !now_registered {
            eprintln!("Failed to register MPC public key. Aborting.");
            return Ok(());
        }
    }

    // =============================================
    // Step 2: Build intent and get MPC signature
    // =============================================
    println!("=== Step 2: Build intent and create signing proposal ===\n");

    // Build the intent (using mock deposit address for now)
    let deposit_address = "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e";
    let amount = "100000000000000000000000"; // 0.1 wNEAR
    let deadline = (chrono::Utc::now() + chrono::Duration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let intent_message = json!({
        "deadline": deadline,
        "intents": [{
            "intent": "transfer",
            "receiver_id": deposit_address,
            "tokens": { "nep141:wrap.near": amount },
        }],
        "signer_id": DAO_ID,
    }).to_string();

    // Build versioned nonce (fetch salt from intents.near)
    let client = reqwest::Client::new();
    let salt_resp = client
        .post("https://rpc.mainnet.near.org")
        .json(&json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "optimistic",
                "account_id": "intents.near",
                "method_name": "current_salt",
                "args_base64": BASE64.encode("{}"),
            }
        }))
        .send().await?.json::<Value>().await?;

    let salt_result: Vec<u8> = salt_resp["result"]["result"]
        .as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap() as u8).collect();
    let salt_hex = String::from_utf8(salt_result)?.trim_matches('"').to_string();
    let salt_bytes = hex::decode(&salt_hex)?;
    let salt: [u8; 4] = salt_bytes.try_into().expect("Salt must be 4 bytes");

    // Build versioned nonce
    let deadline_dt = chrono::Utc::now() + chrono::Duration::hours(24);
    let deadline_ns: u64 = (deadline_dt.timestamp_millis() as u64) * 1_000_000;
    let now_ns: u64 = (chrono::Utc::now().timestamp_millis() as u64) * 1_000_000;
    let random_tail: [u8; 7] = rand::random();

    let mut nonce = [0u8; 32];
    nonce[0..4].copy_from_slice(&[0x56, 0x28, 0xF6, 0xC6]); // magic
    nonce[4] = 0; // version
    nonce[5..9].copy_from_slice(&salt);
    nonce[9..17].copy_from_slice(&deadline_ns.to_le_bytes());
    nonce[17..25].copy_from_slice(&now_ns.to_le_bytes());
    nonce[25..32].copy_from_slice(&random_tail);

    let nonce_b64 = BASE64.encode(nonce);
    let recipient = "intents.near";

    println!("Intent message: {}...{}", &intent_message[..50], &intent_message[intent_message.len()-30..]);
    println!("Nonce: {}", nonce_b64);

    // Compute NEP-413 hash
    let payload = NEP413Payload {
        message: intent_message.clone(),
        nonce,
        recipient: recipient.to_string(),
        callback_url: None,
    };

    const NEP413_PREFIX: u32 = (1u32 << 31) + 413;
    let mut bytes = NEP413_PREFIX.to_le_bytes().to_vec();
    borsh::to_writer(&mut bytes, &payload)?;

    use sha2::Digest;
    let hash = sha2::Sha256::digest(&bytes);
    let hash_hex = hex::encode(&hash);

    println!("NEP-413 hash: {}\n", hash_hex);

    // Create signing proposal
    let signer_args = json!({
        "request": {
            "payload_v2": { "Eddsa": hash_hex },
            "path": DAO_ID,
            "domain_id": 1,
        }
    });

    let proposal = json!({
        "proposal": {
            "description": "Confidential shield: sign intent via v1.signer",
            "kind": {
                "FunctionCall": {
                    "receiver_id": "v1.signer",
                    "actions": [{
                        "method_name": "sign",
                        "args": BASE64.encode(serde_json::to_string(&signer_args)?.as_bytes()),
                        "deposit": "1",
                        "gas": "250000000000000",
                    }],
                }
            }
        }
    });

    println!("Creating signing proposal...");
    Transaction::construct(
        ACCOUNT_ID.parse().unwrap(), DAO_ID.parse().unwrap(),
    )
    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: "add_proposal".to_string(),
        args: serde_json::to_vec(&proposal)?.into(),
        gas: NearGas::from_tgas(100),
        deposit: NearToken::from_yoctonear(0),
    })))
    .with_signer(near_api::signer::Signer::new(
        near_api::signer::secret_key::SecretKeySigner::new(near_secret.clone()),
    ).unwrap())
    .send_to(&near_api::NetworkConfig::mainnet())
    .await?;

    // Get proposal ID
    let resp = client
        .post("https://rpc.mainnet.near.org")
        .json(&json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": DAO_ID,
                "method_name": "get_last_proposal_id",
                "args_base64": BASE64.encode("{}"),
            }
        }))
        .send().await?.json::<Value>().await?;

    let result_bytes: Vec<u8> = resp["result"]["result"]
        .as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap() as u8).collect();
    let last_id: u64 = String::from_utf8(result_bytes)?.parse()?;
    let proposal_id = last_id - 1;
    println!("Signing proposal ID: {}", proposal_id);

    // =============================================
    // Step 3: Approve and get MPC signature
    // =============================================
    println!("\n=== Step 3: Approve proposal to get MPC signature ===\n");

    // Fetch proposal kind
    let resp = client
        .post("https://rpc.mainnet.near.org")
        .json(&json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "query",
            "params": {
                "request_type": "call_function",
                "finality": "final",
                "account_id": DAO_ID,
                "method_name": "get_proposal",
                "args_base64": BASE64.encode(json!({"id": proposal_id}).to_string()),
            }
        }))
        .send().await?.json::<Value>().await?;

    let result_bytes: Vec<u8> = resp["result"]["result"]
        .as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap() as u8).collect();
    let proposal_data: Value = serde_json::from_slice(&result_bytes)?;
    let kind = &proposal_data["kind"];

    println!("Approving...");
    let approve_tx = Transaction::construct(
        ACCOUNT_ID.parse().unwrap(), DAO_ID.parse().unwrap(),
    )
    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: "act_proposal".to_string(),
        args: serde_json::to_vec(&json!({
            "id": proposal_id,
            "action": "VoteApprove",
            "proposal": kind,
        }))?.into(),
        gas: NearGas::from_tgas(300),
        deposit: NearToken::from_yoctonear(0),
    })))
    .with_signer(near_api::signer::Signer::new(
        near_api::signer::secret_key::SecretKeySigner::new(near_secret),
    ).unwrap())
    .send_to(&near_api::NetworkConfig::mainnet())
    .await?;

    // Extract the MPC signature from the execution result
    let mut mpc_signature: Option<Vec<u8>> = None;
    println!("Looking for MPC signature in execution receipts...");

    // The MPC response is a JSON like {"scheme":"Ed25519","signature":[...]}
    // base64-encoded as a SuccessValue. Search for the known b64 prefix.
    let result_debug = format!("{:?}", approve_tx);
    // "eyJzY2hlbWUi" is base64 for '{"scheme"' — unique to MPC responses
    let marker = "eyJzY2hlbWUi";
    if let Some(start) = result_debug.find(marker) {
        // Find the end of this base64 string (next non-base64 char)
        let rest = &result_debug[start..];
        let end = rest.find(|c: char| !c.is_alphanumeric() && c != '+' && c != '/' && c != '=')
            .unwrap_or(rest.len());
        let b64_value = &rest[..end];

        if let Ok(decoded) = BASE64.decode(b64_value) {
            if let Ok(sig_json) = serde_json::from_slice::<Value>(&decoded) {
                println!("MPC response: {}", sig_json);
                let sig_array: Vec<u8> = sig_json["signature"]
                    .as_array().unwrap()
                    .iter().map(|v| v.as_u64().unwrap() as u8).collect();
                mpc_signature = Some(sig_array);
            }
        }
    }

    let sig_bytes = match mpc_signature {
        Some(s) => {
            println!("\nMPC signature ({} bytes): {}", s.len(), hex::encode(&s[..8]));
            s
        }
        None => {
            eprintln!("Could not extract MPC signature from execution result.");
            // Save full debug output for inspection
            std::fs::write("examples/fixtures/approve_debug.txt", &result_debug)?;
            eprintln!("Full debug output saved to examples/fixtures/approve_debug.txt");
            return Ok(());
        }
    };

    // =============================================
    // Step 4: Build and submit the signed intent
    // =============================================
    println!("\n=== Step 4: Submit signed intent to 1Click API ===\n");

    // Format signature as ed25519:base58
    let sig_b58 = format!("ed25519:{}", bs58::encode(&sig_bytes).into_string());
    println!("Signature: {}", sig_b58);

    // Build the signed intent (same format as captured from near.com)
    let signed_intent = json!([{
        "signedIntent": {
            "standard": "nep413",
            "payload": {
                "message": intent_message,
                "nonce": nonce_b64,
                "recipient": recipient,
            },
            "public_key": MPC_PUBLIC_KEY,
            "signature": sig_b58,
        }
    }]);

    println!("Signed intent: {}", serde_json::to_string_pretty(&signed_intent)?);

    // Note: Submitting to the actual 1Click API would require the auth flow
    // For now, save the signed intent as a fixture
    std::fs::create_dir_all("examples/fixtures").ok();
    std::fs::write(
        "examples/fixtures/signed_confidential_intent.json",
        serde_json::to_string_pretty(&signed_intent)?,
    )?;
    println!("\nSaved signed intent to examples/fixtures/signed_confidential_intent.json");

    println!("\n=== Full confidential shield flow complete! ===");
    println!("To execute the actual transfer, this signed intent needs to be");
    println!("submitted to the 1Click API along with an on-chain ft_transfer_call.");

    Ok(())
}
