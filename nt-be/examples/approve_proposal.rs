//! Approve a proposal on the dev treasury.
//! Run with: cargo run --example approve_proposal

use near_api::{
    NearGas, NearToken, Transaction,
    types::{Action, transaction::actions::FunctionCallAction},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::from_filename("../.env").ok();
    dotenvy::from_filename(".env").ok();

    let proposal_id: u64 = std::env::args()
        .nth(1)
        .unwrap_or("0".to_string())
        .parse()?;

    let secret: near_api::SecretKey =
        std::env::var("PETERSALOMONSEN_DEV")?.parse()?;

    println!("Approving proposal {} on petersalomonsendev.sputnik-dao.near...", proposal_id);

    let tx = Transaction::construct(
        "petersalomonsendev.near".parse().unwrap(),
        "petersalomonsendev.sputnik-dao.near".parse().unwrap(),
    )
    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: "act_proposal".to_string(),
        args: serde_json::to_vec(&serde_json::json!({
            "id": proposal_id,
            "action": "VoteApprove"
        }))?
        .into(),
        gas: NearGas::from_tgas(200),
        deposit: NearToken::from_yoctonear(0),
    })))
    .with_signer(
        near_api::signer::Signer::new(
            near_api::signer::secret_key::SecretKeySigner::new(secret),
        )
        .unwrap(),
    )
    .send_to(&near_api::NetworkConfig::mainnet())
    .await;

    match tx {
        Ok(r) => {
            println!("Approved! Gas: {:?}", r.total_gas_burnt);
            println!("Result: {:?}", r);
        }
        Err(e) => eprintln!("Failed: {:?}", e),
    }
    Ok(())
}
