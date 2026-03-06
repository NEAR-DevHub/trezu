//! RPC balance verification for block 188102401 (intents swap settlement).
//!
//! At block 188102401, receipt `5chj6XaV` executes `on_proposal_callback` on
//! webassemblymusic-treasury.sputnik-dao.near. This commits an outgoing 0.1 NEAR
//! transfer to petersalomonsen.near, which lands one block later (188102402).
//!
//! The DAO's NEAR balance drops by ~0.0999 at 188102401. Neither petersalomonsen.near
//! nor intents.near have a balance change at this block — only at 188102402.
//!
//! This test documents the correct counterparty resolution: the DAO sends NEAR to
//! petersalomonsen.near (not intents.near, despite this being part of an intents swap tx).
//!
//! ```bash
//! cargo test --test block_188102401_balance_test -- --nocapture
//! ```

mod common;

use bigdecimal::BigDecimal;
use nt_be::handlers::balance_changes::balance::near::get_balance_at_block;
use std::str::FromStr;

const DAO: &str = "webassemblymusic-treasury.sputnik-dao.near";
const PETER: &str = "petersalomonsen.near";
const INTENTS: &str = "intents.near";

#[tokio::test]
async fn test_block_188102401_balance_changes() {
    let network = common::create_archival_network();

    // Query balances at blocks 188102400, 188102401, 188102402
    let dao_400 = get_balance_at_block(&network, DAO, 188_102_400)
        .await
        .unwrap();
    let dao_401 = get_balance_at_block(&network, DAO, 188_102_401)
        .await
        .unwrap();
    let dao_402 = get_balance_at_block(&network, DAO, 188_102_402)
        .await
        .unwrap();

    let peter_400 = get_balance_at_block(&network, PETER, 188_102_400)
        .await
        .unwrap();
    let peter_401 = get_balance_at_block(&network, PETER, 188_102_401)
        .await
        .unwrap();
    let peter_402 = get_balance_at_block(&network, PETER, 188_102_402)
        .await
        .unwrap();

    let intents_400 = get_balance_at_block(&network, INTENTS, 188_102_400)
        .await
        .unwrap();
    let intents_401 = get_balance_at_block(&network, INTENTS, 188_102_401)
        .await
        .unwrap();
    let intents_402 = get_balance_at_block(&network, INTENTS, 188_102_402)
        .await
        .unwrap();

    let zero = BigDecimal::from(0);

    // --- Block 188102400 → 188102401 ---
    // DAO balance drops ~0.0999 NEAR (on_proposal_callback commits the transfer)
    let dao_delta_401 = &dao_401 - &dao_400;
    println!("DAO     400→401: {dao_delta_401}");
    assert!(
        dao_delta_401 < zero,
        "DAO should lose NEAR at 188102401, got {dao_delta_401}"
    );
    // Approx -0.0999
    let expected_min = BigDecimal::from_str("-0.11").unwrap();
    let expected_max = BigDecimal::from_str("-0.09").unwrap();
    assert!(
        dao_delta_401 > expected_min && dao_delta_401 < expected_max,
        "DAO delta should be ~-0.0999, got {dao_delta_401}"
    );

    // petersalomonsen.near: NO change at 188102401
    let peter_delta_401 = &peter_401 - &peter_400;
    println!("peter   400→401: {peter_delta_401}");
    assert_eq!(
        peter_delta_401, zero,
        "peter should have no change at 188102401, got {peter_delta_401}"
    );

    // intents.near: NO change at 188102401
    let intents_delta_401 = &intents_401 - &intents_400;
    println!("intents 400→401: {intents_delta_401}");
    assert_eq!(
        intents_delta_401, zero,
        "intents should have no change at 188102401, got {intents_delta_401}"
    );

    // --- Block 188102401 → 188102402 ---
    // DAO: no further change
    let dao_delta_402 = &dao_402 - &dao_401;
    println!("DAO     401→402: {dao_delta_402}");
    assert_eq!(
        dao_delta_402, zero,
        "DAO should have no change at 188102402, got {dao_delta_402}"
    );

    // petersalomonsen.near receives 0.1 NEAR at 188102402
    let peter_delta_402 = &peter_402 - &peter_401;
    println!("peter   401→402: {peter_delta_402}");
    assert!(
        peter_delta_402 > zero,
        "peter should receive NEAR at 188102402, got {peter_delta_402}"
    );
    let expected_receive = BigDecimal::from_str("0.1").unwrap();
    assert_eq!(
        peter_delta_402, expected_receive,
        "peter should receive exactly 0.1 NEAR at 188102402"
    );

    println!("\nConclusion: counterparty for DAO's -0.0999 at 188102401 is petersalomonsen.near");
    println!("(transfer committed at 188102401, received at 188102402)");
}
