//! Full confidential shield flow: create a DAO proposal to sign via v1.signer.
//!
//! This script:
//! 1. Builds a mock confidential shield quote + intent (same as frontend PoC)
//! 2. Computes the NEP-413 hash (same as frontend proposal-builder.ts)
//! 3. Creates an add_proposal transaction targeting v1.signer::sign
//! 4. Signs and submits the transaction on-chain
//!
//! Run with: cargo run --example test_confidential_proposal

use near_api::{
    NearGas, NearToken, Transaction,
    types::{Action, transaction::actions::FunctionCallAction},
};
use serde_json::json;

const ACCOUNT_ID: &str = "petersalomonsendev.near";
const DAO_ID: &str = "petersalomonsendev.sputnik-dao.near";
const V1_SIGNER: &str = "v1.signer";

/// NEP-413 payload for borsh serialization
#[derive(borsh::BorshSerialize)]
struct NEP413Payload {
    message: String,
    nonce: [u8; 32],
    recipient: String,
    callback_url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::from_filename("../.env").ok();
    dotenvy::from_filename(".env").ok();

    let secret_key_str =
        std::env::var("PETERSALOMONSEN_DEV").expect("PETERSALOMONSEN_DEV must be set");
    let near_secret: near_api::SecretKey = secret_key_str.parse()?;

    // =============================================
    // Step 1: Build a mock intent (same as frontend PoC mock)
    // =============================================
    println!("=== Step 1: Building mock intent payload ===\n");

    let deposit_address = "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e";
    let amount = "100000000000000000000000"; // 0.1 wNEAR
    let deadline = (chrono::Utc::now() + chrono::Duration::hours(24))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let intent_message = json!({
        "deadline": deadline,
        "intents": [{
            "intent": "transfer",
            "receiver_id": deposit_address,
            "tokens": { "nep141:wrap.near": amount },
        }],
        "signer_id": DAO_ID,
    })
    .to_string();

    // Use the captured nonce from real near.com flow
    let nonce_b64 = "Vij2xgAlKBKzgB67tZAvnxgPVIiJkIBxtPcWOQPg6MM=";
    let nonce_bytes: Vec<u8> =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, nonce_b64)?;
    let nonce: [u8; 32] = nonce_bytes.try_into().expect("Nonce must be 32 bytes");
    let recipient = "intents.near";

    println!("Intent message: {}", intent_message);
    println!("Nonce: {}", nonce_b64);
    println!("Recipient: {}\n", recipient);

    // =============================================
    // Step 2: Compute NEP-413 hash (what v1.signer signs)
    // =============================================
    println!("=== Step 2: Computing NEP-413 hash ===\n");

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
    let hash_array: Vec<u8> = hash.to_vec();

    println!("NEP-413 hash (hex): {}", hex::encode(&hash_array));
    println!(
        "NEP-413 hash (array): {:?}\n",
        &hash_array[..8] // first 8 bytes for preview
    );

    // =============================================
    // Step 3: Build the DAO proposal
    // =============================================
    println!("=== Step 3: Building DAO proposal ===\n");

    // The proposal calls v1.signer::sign with the NEP-413 hash
    // v1.signer uses payload_v2 with Eddsa variant (hex-encoded) and domain_id=1
    let signer_args = json!({
        "request": {
            "payload_v2": {
                "Eddsa": hex::encode(&hash_array),
            },
            "path": DAO_ID,
            "domain_id": 1,
        }
    });

    let proposal = json!({
        "proposal": {
            "description": "* Proposal Action: confidential-transfer <br>* Notes: Confidential shield of 0.1 wNEAR via private intents. Details hidden for privacy.",
            "kind": {
                "FunctionCall": {
                    "receiver_id": V1_SIGNER,
                    "actions": [{
                        "method_name": "sign",
                        "args": base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            serde_json::to_string(&signer_args)?.as_bytes(),
                        ),
                        "deposit": "1",
                        "gas": "250000000000000",
                    }],
                }
            }
        }
    });

    println!("Proposal:\n{}\n", serde_json::to_string_pretty(&proposal)?);

    // =============================================
    // Step 4: Submit the add_proposal transaction
    // =============================================
    println!("=== Step 4: Submitting add_proposal to DAO ===\n");

    let tx = Transaction::construct(ACCOUNT_ID.parse().unwrap(), DAO_ID.parse().unwrap())
        .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
            method_name: "add_proposal".to_string(),
            args: serde_json::to_vec(&proposal)?.into(),
            gas: NearGas::from_tgas(100),
            deposit: NearToken::from_yoctonear(0), // proposal_bond is 0 for this DAO
        })))
        .with_signer(
            near_api::signer::Signer::new(near_api::signer::secret_key::SecretKeySigner::new(
                near_secret,
            ))
            .unwrap(),
        )
        .send_to(&near_api::NetworkConfig::mainnet())
        .await;

    match tx {
        Ok(result) => {
            println!("Proposal submitted successfully!");
            println!("Gas burnt: {:?}", result.total_gas_burnt);
            println!("Result: {:?}", result);
        }
        Err(e) => {
            eprintln!("Proposal submission failed: {:?}", e);
        }
    }

    Ok(())
}
