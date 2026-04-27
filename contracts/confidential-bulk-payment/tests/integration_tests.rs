// Integration tests for the confidential-bulk-payment subaccount.
//
// Setup:
// - v1.signer / intents.near: replaced by a single mock contract (`mock-mpc`)
//   deployed to both account ids. Returns deterministic ed25519 signatures.
// - sputnik-dao: real `sputnik_dao_v2.wasm` deployed at <prefix>.sputnik-dao.near.
// - confidential-bulk-payment: deployed at <prefix>.bulk-payment.near so the
//   `init` naming-binding check passes.
//
// Flow exercised:
//   bootstrap → DAO add_proposal(FunctionCall to v1.signer.sign) → act_proposal
//   (Approve) → activate(proposal_id) → ping → Signed entries → retry no-op.

use std::sync::OnceLock;

use base64::Engine;
use near_api::{AccountId, NearToken};
use near_sandbox::{
    config::{DEFAULT_GENESIS_ACCOUNT, DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY},
    Sandbox,
};
use near_sdk::serde_json::{self, json};

const SPUTNIK_WASM_REL: &str = "../../nt-fe/public/sputnik_dao_v2.wasm";

fn genesis_signer() -> std::sync::Arc<near_api::Signer> {
    near_api::Signer::from_secret_key(DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap())
        .unwrap()
}

fn genesis_id() -> AccountId {
    DEFAULT_GENESIS_ACCOUNT.as_str().parse().unwrap()
}

// ── WASM caches ────────────────────────────────────────────────────────────
// First test in the run pays the build cost; subsequent tests share the bytes
// instead of re-invoking `cargo near build`.

fn mock_mpc_wasm() -> &'static [u8] {
    static CACHE: OnceLock<Vec<u8>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let manifest =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/mock-mpc/Cargo.toml");
        let wasm_path = cargo_near_build::build_with_cli(cargo_near_build::BuildOpts {
            manifest_path: Some(camino::Utf8PathBuf::from_path_buf(manifest).unwrap()),
            no_locked: true,
            ..Default::default()
        })
        .expect("build mock-mpc");
        std::fs::read(wasm_path).unwrap()
    })
}

fn main_wasm() -> &'static [u8] {
    static CACHE: OnceLock<Vec<u8>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let wasm_path = cargo_near_build::build_with_cli(Default::default())
            .expect("build confidential-bulk-payment");
        std::fs::read(wasm_path).unwrap()
    })
}

fn sputnik_wasm() -> &'static [u8] {
    static CACHE: OnceLock<Vec<u8>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(SPUTNIK_WASM_REL);
        std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e))
    })
}

// ── Test context ───────────────────────────────────────────────────────────

struct Ctx {
    _sandbox: Sandbox,
    network: near_api::NetworkConfig,
    contract_id: AccountId,
    dao_id: AccountId,
}

impl Ctx {
    fn signer(&self) -> std::sync::Arc<near_api::Signer> {
        genesis_signer()
    }

    fn caller(&self) -> AccountId {
        genesis_id()
    }
}

/// Spin up sandbox, materialize the four required accounts via state-patching,
/// deploy the two mocks + sputnik-dao + confidential-bulk-payment.
async fn setup() -> testresult::TestResult<Ctx> {
    let prefix = "mydao";
    let sandbox = Sandbox::start_sandbox().await?;
    let network =
        near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);

    let signer_id: AccountId = "v1.signer".parse().unwrap();
    let intents_id: AccountId = "intents.near".parse().unwrap();
    let dao_id: AccountId = format!("{prefix}.sputnik-dao.near").parse().unwrap();
    let contract_id: AccountId = format!("{prefix}.bulk-payment.near").parse().unwrap();

    // Sandbox state-patches each account in with the genesis full-access key,
    // so the genesis signer authenticates for all of them.
    for id in [&signer_id, &intents_id, &dao_id, &contract_id] {
        sandbox
            .create_account(id.clone())
            .initial_balance(NearToken::from_near(50))
            .send()
            .await?;
    }

    // Mocks for v1.signer + intents.near (same wasm, both surfaces inside).
    for id in [&signer_id, &intents_id] {
        near_api::Contract::deploy(id.clone())
            .use_code(mock_mpc_wasm().to_vec())
            .with_init_call("new", ())?
            .with_signer(genesis_signer())
            .send_to(&network)
            .await?
            .into_result()?;
    }

    // Sputnik DAO with a single-member council (the genesis account).
    near_api::Contract::deploy(dao_id.clone())
        .use_code(sputnik_wasm().to_vec())
        .with_init_call(
            "new",
            json!({
                "config": { "name": prefix, "purpose": "test", "metadata": "" },
                "policy": [DEFAULT_GENESIS_ACCOUNT.as_str()]
            }),
        )?
        .with_signer(genesis_signer())
        .send_to(&network)
        .await?
        .into_result()?;

    // Confidential-bulk-payment subaccount, owned by the DAO above.
    near_api::Contract::deploy(contract_id.clone())
        .use_code(main_wasm().to_vec())
        .with_init_call("init", json!({ "owner_dao": dao_id.to_string() }))?
        .with_signer(genesis_signer())
        .send_to(&network)
        .await?
        .into_result()?;

    Ok(Ctx {
        _sandbox: sandbox,
        network,
        contract_id,
        dao_id,
    })
}

// ── DAO helpers ────────────────────────────────────────────────────────────

/// Round-trip the proposal kind through the DAO so `act_proposal`'s strict
/// kind-equality check sees the exact same encoding the contract stored.
async fn fetch_proposal_kind(ctx: &Ctx, proposal_id: u64) -> serde_json::Value {
    let proposal: serde_json::Value = near_api::Contract(ctx.dao_id.clone())
        .call_function("get_proposal", json!({ "id": proposal_id }))
        .read_only()
        .fetch_from(&ctx.network)
        .await
        .unwrap()
        .data;
    proposal["proposal"]["kind"].clone()
}

/// Add a FunctionCall proposal carrying `payload_hashes` in the description and
/// vote it through. Returns the assigned proposal id.
async fn add_and_approve_proposal(
    ctx: &Ctx,
    payload_hashes_csv: &str,
) -> testresult::TestResult<u64> {
    // Valid SignRequest JSON so the FunctionCall executed by the DAO on
    // approval deserializes cleanly at (mock) v1.signer. The actual payload
    // is irrelevant for proposal-status purposes; per-hash signing happens
    // later via `ping`.
    let sign_args_json = serde_json::to_vec(&json!({
        "request": {
            "path": "",
            "payload_v2": { "Eddsa": "0".repeat(64) },
            "domain_id": 1,
        }
    }))?;
    let stub_args = base64::engine::general_purpose::STANDARD.encode(&sign_args_json);
    let proposal_kind = json!({
        "FunctionCall": {
            "receiver_id": "v1.signer",
            "actions": [{
                "method_name": "sign",
                "args": stub_args,
                "deposit": "1",
                "gas": "30000000000000"
            }]
        }
    });

    let proposal_id: u64 = near_api::Contract(ctx.dao_id.clone())
        .call_function("get_last_proposal_id", ())
        .read_only()
        .fetch_from(&ctx.network)
        .await?
        .data;

    near_api::Contract(ctx.dao_id.clone())
        .call_function(
            "add_proposal",
            json!({
                "proposal": {
                    "description": format!("* payload_hashes: {payload_hashes_csv}"),
                    "kind": proposal_kind,
                }
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1)) // sputnik default proposal_bond
        .gas(near_sdk::Gas::from_tgas(100))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?;

    near_api::Contract(ctx.dao_id.clone())
        .call_function(
            "act_proposal",
            json!({ "id": proposal_id, "action": "VoteApprove", "proposal": proposal_kind }),
        )
        .transaction()
        .gas(near_sdk::Gas::from_tgas(250))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?;

    Ok(proposal_id)
}

async fn read_bootstrap(ctx: &Ctx) -> serde_json::Value {
    near_api::Contract(ctx.contract_id.clone())
        .call_function("get_bootstrap_status", ())
        .read_only()
        .fetch_from(&ctx.network)
        .await
        .unwrap()
        .data
}

async fn read_activation(ctx: &Ctx, proposal_id: u64) -> serde_json::Value {
    near_api::Contract(ctx.contract_id.clone())
        .call_function(
            "get_activation",
            json!({ "proposal_id": proposal_id.to_string() }),
        )
        .read_only()
        .fetch_from(&ctx.network)
        .await
        .unwrap()
        .data
}

async fn bootstrap(ctx: &Ctx) -> testresult::TestResult<()> {
    let res = near_api::Contract(ctx.contract_id.clone())
        .call_function("bootstrap", ())
        .transaction()
        .gas(near_sdk::Gas::from_tgas(100))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?;
    for log in res.logs() {
        println!("  bootstrap log: {log}");
    }
    Ok(())
}

async fn activate(ctx: &Ctx, proposal_id: u64) -> testresult::TestResult<()> {
    let required: NearToken = near_api::Contract(ctx.contract_id.clone())
        .call_function("activate_required_deposit", ())
        .read_only()
        .fetch_from(&ctx.network)
        .await?
        .data;
    let res = near_api::Contract(ctx.contract_id.clone())
        .call_function("activate", json!({ "proposal_id": proposal_id.to_string() }))
        .transaction()
        .deposit(required)
        .gas(near_sdk::Gas::from_tgas(100))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?;
    for log in res.logs() {
        println!("  activate log: {log}");
    }
    Ok(())
}

async fn ping(ctx: &Ctx, proposal_id: u64) -> testresult::TestResult<u32> {
    Ok(near_api::Contract(ctx.contract_id.clone())
        .call_function("ping", json!({ "proposal_id": proposal_id.to_string() }))
        .transaction()
        .gas(near_sdk::Gas::from_tgas(300))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?
        .json()?)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_full_flow() -> testresult::TestResult {
    let ctx = setup().await?;

    println!("\n══════════ STAGE 0: pre-bootstrap state ══════════");
    println!("contract_id: {}", ctx.contract_id);
    println!("dao_id:      {}", ctx.dao_id);
    println!("bootstrap status: {}", read_bootstrap(&ctx).await);

    let pk: String = near_api::Contract("v1.signer".parse().unwrap())
        .call_function(
            "derived_public_key",
            json!({ "path": "", "predecessor": ctx.contract_id.to_string(), "domain_id": 1 }),
        )
        .read_only()
        .fetch_from(&ctx.network)
        .await?
        .data;
    println!("v1.signer.derived_public_key (mock) → {pk}");
    assert!(pk.starts_with("ed25519:"), "mock pk: {pk}");

    println!("\n══════════ STAGE 1: bootstrap ══════════");
    bootstrap(&ctx).await?;
    let bootstrap_status = read_bootstrap(&ctx).await;
    println!("bootstrap status (after): {bootstrap_status}");
    assert!(
        bootstrap_status.get("Ready").is_some(),
        "expected Ready, got {bootstrap_status:?}"
    );

    println!("\n══════════ STAGE 2: DAO add + approve proposal ══════════");
    let h1 = "a".repeat(64);
    let h2 = "b".repeat(64);
    let csv = format!("{h1},{h2}");
    println!(
        "payload_hashes ({} chars each): [{}…, {}…]",
        h1.len(),
        &h1[..8],
        &h2[..8]
    );
    let proposal_id = add_and_approve_proposal(&ctx, &csv).await?;
    println!("proposal_id: {proposal_id}");

    let proposal: serde_json::Value = near_api::Contract(ctx.dao_id.clone())
        .call_function("get_proposal", json!({ "id": proposal_id }))
        .read_only()
        .fetch_from(&ctx.network)
        .await?
        .data;
    println!("proposal status (DAO view): {}", proposal["proposal"]["status"]);

    println!("\n══════════ STAGE 3: activate ══════════");
    activate(&ctx, proposal_id).await?;
    let activation = read_activation(&ctx, proposal_id).await;
    println!("activation (after activate):\n{activation:#}");
    assert_eq!(activation["hashes"].as_array().unwrap().len(), 2);
    assert!(
        activation["status"]["Ready"].is_object(),
        "status: {}",
        activation["status"]
    );

    println!("\n══════════ STAGE 4: ping (dispatch sign) ══════════");
    let dispatched = ping(&ctx, proposal_id).await?;
    println!("ping dispatched: {dispatched}");
    assert_eq!(dispatched, 2);

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let activation = read_activation(&ctx, proposal_id).await;
    println!("activation (after ping + callbacks):\n{activation:#}");
    assert_eq!(activation["status"], "Done");
    for entry in activation["hashes"].as_array().unwrap() {
        assert!(
            entry["status"].get("Signed").is_some(),
            "expected Signed, got {}",
            entry["status"]
        );
    }

    println!("\n══════════ STAGE 5: retry_failed (no-op) ══════════");
    let retried: u32 = near_api::Contract(ctx.contract_id.clone())
        .call_function(
            "retry_failed",
            json!({ "proposal_id": proposal_id.to_string() }),
        )
        .transaction()
        .gas(near_sdk::Gas::from_tgas(50))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?
        .json()?;
    println!("retry_failed reset count: {retried}");
    assert_eq!(retried, 0);

    Ok(())
}

#[tokio::test]
async fn test_activate_rejects_unapproved_proposal() -> testresult::TestResult {
    let ctx = setup().await?;
    bootstrap(&ctx).await?;

    // Add a proposal but never vote it through.
    let sign_args_json = serde_json::to_vec(&json!({
        "request": {
            "path": "",
            "payload_v2": { "Eddsa": "0".repeat(64) },
            "domain_id": 1,
        }
    }))?;
    let stub_args = base64::engine::general_purpose::STANDARD.encode(&sign_args_json);
    let proposal_kind = json!({
        "FunctionCall": {
            "receiver_id": "v1.signer",
            "actions": [{
                "method_name": "sign",
                "args": stub_args,
                "deposit": "1",
                "gas": "30000000000000"
            }]
        }
    });
    let h = "c".repeat(64);
    near_api::Contract(ctx.dao_id.clone())
        .call_function(
            "add_proposal",
            json!({
                "proposal": {
                    "description": format!("* payload_hashes: {h}"),
                    "kind": proposal_kind,
                }
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .gas(near_sdk::Gas::from_tgas(100))
        .with_signer(ctx.caller(), ctx.signer())
        .send_to(&ctx.network)
        .await?
        .into_result()?;

    // activate's transaction succeeds (it just kicks off the cross-contract
    // get_proposal call); the callback aborts because the proposal is not
    // Approved → activation entry is removed.
    activate(&ctx, 0).await?;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    let activation: Option<serde_json::Value> = near_api::Contract(ctx.contract_id.clone())
        .call_function("get_activation", json!({ "proposal_id": "0" }))
        .read_only()
        .fetch_from(&ctx.network)
        .await?
        .data;
    assert!(
        activation.is_none(),
        "activation should be aborted, got {activation:?}"
    );

    Ok(())
}

#[tokio::test]
async fn test_malformed_hashes_are_skipped() -> testresult::TestResult {
    let ctx = setup().await?;
    bootstrap(&ctx).await?;

    // Mix three malformed entries (too short, uppercase hex, non-hex char)
    // among two valid ones. Activation must accept the list, mark the bad
    // ones Invalid, and ping must only dispatch sign for the valid hashes.
    let good1 = "a".repeat(64);
    let good2 = "1".repeat(64);
    let too_short = "ab".repeat(10); // 20 chars
    let upper = "A".repeat(64);
    let non_hex = "z".repeat(64);
    let csv = format!("{good1},{too_short},{upper},{good2},{non_hex}");

    let proposal_id = add_and_approve_proposal(&ctx, &csv).await?;
    activate(&ctx, proposal_id).await?;

    let activation = read_activation(&ctx, proposal_id).await;
    println!("activation (mixed valid/invalid):\n{activation:#}");

    let hashes = activation["hashes"].as_array().unwrap();
    assert_eq!(hashes.len(), 5);

    let statuses: Vec<&serde_json::Value> = hashes.iter().map(|h| &h["status"]).collect();
    assert_eq!(statuses[0], "Pending", "hash[0] (good1) should be Pending");
    assert_eq!(statuses[3], "Pending", "hash[3] (good2) should be Pending");
    for i in [1, 2, 4] {
        assert!(
            statuses[i]["Invalid"]["reason"] == "MalformedHex",
            "hash[{i}] expected Invalid::MalformedHex, got {}",
            statuses[i]
        );
    }

    let dispatched = ping(&ctx, proposal_id).await?;
    assert_eq!(dispatched, 2, "expected 2 valid hashes signed");

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let activation = read_activation(&ctx, proposal_id).await;
    println!("activation (after ping):\n{activation:#}");

    assert_eq!(
        activation["status"], "Done",
        "cursor should walk past all entries, including Invalid ones"
    );

    let hashes = activation["hashes"].as_array().unwrap();
    assert!(hashes[0]["status"].get("Signed").is_some());
    assert!(hashes[3]["status"].get("Signed").is_some());
    for i in [1, 2, 4] {
        assert!(
            hashes[i]["status"]["Invalid"]["reason"] == "MalformedHex",
            "Invalid status should persist through ping for hash[{i}]"
        );
    }

    Ok(())
}
