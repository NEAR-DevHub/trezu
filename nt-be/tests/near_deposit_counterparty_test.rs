/// Integration test for NEAR transfer counterparty resolution.
///
/// Reproduces the bug where native NEAR transfers between DAOs show the
/// approver (or meta-tx delegate target) as the counterparty instead of the
/// actual sending/receiving DAO.
///
/// Tests both directions:
/// - Incoming: olskik-test receives 0.1 NEAR from testing-astradao
/// - Outgoing: olskik-test sends 1.0 NEAR to lesik-o
///
/// The fix extracts `predecessor_id` (for incoming) and child receipt
/// `executor_id` (for outgoing) from the receipt chain via RPC.
///
/// ```bash
/// cargo test --test near_deposit_counterparty_test -- --nocapture
/// ```
mod common;

use sqlx::PgPool;

const TARGET_DAO: &str = "olskik-test.sputnik-dao.near";
const SOURCE_DAO: &str = "testing-astradao.sputnik-dao.near";
const LESIK_DAO: &str = "lesik-o.sputnik-dao.near";

// Incoming: testing-astradao → olskik-test (0.1 NEAR)
const INCOMING_TX: &str = "4ZM64KR7WgKExWn4TcBvwHWBuC4NjnUd9MWzxskHrEpH";
const INCOMING_BLOCK: i64 = 190792143;

// Outgoing: olskik-test → lesik-o (1.0 NEAR)
const OUTGOING_TX: &str = "FxWS6iXr8nqYX936GSHqmfqWfxsc4QrnbbKRwtHEfRhz";
const OUTGOING_BLOCK: i64 = 190790034;

const FIXTURE_COUNT: i64 = 6;

/// Load fixture SQL into indexed_dao_outcomes.
async fn load_fixtures(pool: &PgPool, fixture_sql: &str) {
    for stmt in fixture_sql.split(';').filter(|s| !s.trim().is_empty()) {
        let trimmed = stmt.trim();
        if trimmed.starts_with("--") && !trimmed.contains("INSERT") {
            continue;
        }
        sqlx::query(trimmed)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("Failed to execute fixture SQL: {e}\nStatement: {trimmed}"));
    }
}

/// Query balance_changes for a specific NEAR record by account and tx hash.
/// Returns the record with the largest absolute amount (the actual transfer,
/// not the gas refund).
async fn get_near_balance_change(
    pool: &PgPool,
    account_id: &str,
    tx_hash: &str,
) -> Option<(String, String)> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT counterparty, amount::text
         FROM balance_changes
         WHERE account_id = $1 AND token_id = 'near' AND $2 = ANY(transaction_hashes)
         ORDER BY ABS(amount) DESC
         LIMIT 1",
    )
    .bind(account_id)
    .bind(tx_hash)
    .fetch_optional(pool)
    .await
    .unwrap()
}

/// Set up monitored accounts and cursor for enrichment.
async fn setup_enrichment(pool: &PgPool) {
    for dao in [TARGET_DAO, SOURCE_DAO, LESIK_DAO] {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, dirty_at)
             VALUES ($1, true, NOW())
             ON CONFLICT (account_id) DO NOTHING",
        )
        .bind(dao)
        .execute(pool)
        .await
        .unwrap();
    }

    sqlx::query(
        "INSERT INTO goldsky_cursors (consumer_name, last_processed_id, last_processed_block, updated_at)
         VALUES ('balance_enrichment', '', 0, NOW())
         ON CONFLICT (consumer_name) DO UPDATE SET last_processed_id = '', last_processed_block = 0",
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Run enrichment until all outcomes are processed.
async fn run_enrichment(pool: &PgPool, network: &near_api::NetworkConfig) -> usize {
    let mut total = 0usize;
    loop {
        let processed = nt_be::handlers::balance_changes::goldsky_enrichment::run_enrichment_cycle(
            pool,
            pool,
            network,
            None,
            "http://unused",
        )
        .await
        .unwrap();
        total += processed;
        if processed < 100 {
            break;
        }
    }
    total
}

/// Test 1: Incoming NEAR — counterparty should be the source DAO.
///
/// The Transfer receipt on olskik-test has predecessor_id = testing-astradao
/// (the DAO that executed act_proposal and created the Transfer).
#[sqlx::test]
async fn test_incoming_near_counterparty(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();
    let network = common::create_archival_network();

    load_fixtures(
        &pool,
        include_str!("test_data/goldsky_near_deposit_counterparty_fixtures.sql"),
    )
    .await;
    setup_enrichment(&pool).await;

    let total = run_enrichment(&pool, &network).await;
    println!("Enrichment: processed {} outcomes", total);
    assert!(total >= FIXTURE_COUNT as usize);

    let (counterparty, amount) = get_near_balance_change(&pool, TARGET_DAO, INCOMING_TX)
        .await
        .expect("Should have incoming NEAR balance change");

    println!("Incoming: counterparty={}, amount={}", counterparty, amount);

    assert_eq!(
        counterparty, SOURCE_DAO,
        "Incoming counterparty should be source DAO, not the approver"
    );

    println!("PASSED");
}

/// Test 2: Outgoing NEAR — counterparty should be the recipient DAO.
///
/// The act_proposal receipt on olskik-test creates a child Transfer receipt
/// whose executor_id = lesik-o (the recipient of the NEAR).
#[sqlx::test]
async fn test_outgoing_near_counterparty(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();
    let network = common::create_archival_network();

    load_fixtures(
        &pool,
        include_str!("test_data/goldsky_near_deposit_counterparty_fixtures.sql"),
    )
    .await;
    setup_enrichment(&pool).await;

    let total = run_enrichment(&pool, &network).await;
    println!("Enrichment: processed {} outcomes", total);
    assert!(total >= FIXTURE_COUNT as usize);

    let (counterparty, amount) = get_near_balance_change(&pool, TARGET_DAO, OUTGOING_TX)
        .await
        .expect("Should have outgoing NEAR balance change");

    println!("Outgoing: counterparty={}, amount={}", counterparty, amount);

    assert_eq!(
        counterparty, LESIK_DAO,
        "Outgoing counterparty should be recipient DAO, not the delegate target"
    );
    assert!(
        amount.starts_with('-'),
        "Outgoing amount should be negative: {}",
        amount
    );

    println!("PASSED");
}

/// Test 3: Re-enrichment corrects existing wrong counterparty records.
///
/// Inserts balance_changes with wrong counterparty (the old bug), then
/// re-runs enrichment. The ON CONFLICT DO UPDATE upsert should overwrite
/// with the correct counterparty.
#[sqlx::test]
async fn test_re_enrichment_corrects_wrong_counterparty(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();
    let network = common::create_archival_network();

    load_fixtures(
        &pool,
        include_str!("test_data/goldsky_near_deposit_counterparty_fixtures.sql"),
    )
    .await;

    // Insert wrong incoming record
    sqlx::query(
        "INSERT INTO balance_changes
         (account_id, token_id, block_height, block_timestamp, block_time,
          amount, balance_before, balance_after,
          transaction_hashes, receipt_id, signer_id, receiver_id,
          counterparty, actions, raw_data, action_kind, method_name)
         VALUES ($1, 'near', $2, 1774267965606000000, '2026-03-23T12:12:45.606Z',
          0.1, 1.7727, 1.8727,
          ARRAY[$3], '{}'::text[], 'sponsor.trezu.near', 'yurtur.near',
          'yurtur.near', '{}'::jsonb, '{}'::jsonb, 'FUNCTION_CALL', 'act_proposal')",
    )
    .bind(TARGET_DAO)
    .bind(INCOMING_BLOCK)
    .bind(INCOMING_TX)
    .execute(&pool)
    .await
    .unwrap();

    // Insert wrong outgoing record
    sqlx::query(
        "INSERT INTO balance_changes
         (account_id, token_id, block_height, block_timestamp, block_time,
          amount, balance_before, balance_after,
          transaction_hashes, receipt_id, signer_id, receiver_id,
          counterparty, actions, raw_data, action_kind, method_name)
         VALUES ($1, 'near', $2, 1774266706024000000, '2026-03-23T11:51:46.024Z',
          -1.001, 2.7737, 1.7726,
          ARRAY[$3], '{}'::text[], 'sponsor.trezu.near', 'olskik.near',
          'olskik.near', '{}'::jsonb, '{}'::jsonb, 'FUNCTION_CALL', 'act_proposal')",
    )
    .bind(TARGET_DAO)
    .bind(OUTGOING_BLOCK)
    .bind(OUTGOING_TX)
    .execute(&pool)
    .await
    .unwrap();

    // Verify wrong counterparties
    let (wrong_in, _) = get_near_balance_change(&pool, TARGET_DAO, INCOMING_TX)
        .await
        .unwrap();
    let (wrong_out, _) = get_near_balance_change(&pool, TARGET_DAO, OUTGOING_TX)
        .await
        .unwrap();
    assert_eq!(wrong_in, "yurtur.near");
    assert_eq!(wrong_out, "olskik.near");
    println!(
        "Pre-existing: incoming={}, outgoing={}",
        wrong_in, wrong_out
    );

    // Re-run enrichment
    setup_enrichment(&pool).await;
    let total = run_enrichment(&pool, &network).await;
    println!("Re-enrichment: processed {} outcomes", total);

    // Verify corrected
    let (fixed_in, _) = get_near_balance_change(&pool, TARGET_DAO, INCOMING_TX)
        .await
        .unwrap();
    let (fixed_out, _) = get_near_balance_change(&pool, TARGET_DAO, OUTGOING_TX)
        .await
        .unwrap();

    println!(
        "Corrected: incoming={} (was {}), outgoing={} (was {})",
        fixed_in, wrong_in, fixed_out, wrong_out
    );

    assert_eq!(
        fixed_in, SOURCE_DAO,
        "Incoming should be corrected to source DAO"
    );
    assert_eq!(
        fixed_out, LESIK_DAO,
        "Outgoing should be corrected to recipient DAO"
    );

    println!("PASSED");
}

/// Test 4: correct_near_counterparties fixes existing wrong records without
/// needing Goldsky outcomes or cursor reset.
///
/// Inserts balance_changes with wrong counterparty, then runs the correction
/// function which queries the DB, resolves via RPC, and updates directly.
#[sqlx::test]
async fn test_correct_near_counterparties(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();
    let network = common::create_archival_network();

    // Insert wrong incoming record (counterparty = receiver_id)
    sqlx::query(
        "INSERT INTO balance_changes
         (account_id, token_id, block_height, block_timestamp, block_time,
          amount, balance_before, balance_after,
          transaction_hashes, receipt_id, signer_id, receiver_id,
          counterparty, actions, raw_data, action_kind, method_name)
         VALUES ($1, 'near', $2, 1774267965606000000, '2026-03-23T12:12:45.606Z',
          0.1, 1.7727, 1.8727,
          ARRAY[$3], '{}'::text[], 'sponsor.trezu.near', 'yurtur.near',
          'yurtur.near', '{}'::jsonb, '{}'::jsonb, 'FUNCTION_CALL', 'act_proposal')",
    )
    .bind(TARGET_DAO)
    .bind(INCOMING_BLOCK)
    .bind(INCOMING_TX)
    .execute(&pool)
    .await
    .unwrap();

    // Insert wrong outgoing record (counterparty = receiver_id)
    sqlx::query(
        "INSERT INTO balance_changes
         (account_id, token_id, block_height, block_timestamp, block_time,
          amount, balance_before, balance_after,
          transaction_hashes, receipt_id, signer_id, receiver_id,
          counterparty, actions, raw_data, action_kind, method_name)
         VALUES ($1, 'near', $2, 1774266706024000000, '2026-03-23T11:51:46.024Z',
          -1.001, 2.7737, 1.7726,
          ARRAY[$3], '{}'::text[], 'sponsor.trezu.near', 'olskik.near',
          'olskik.near', '{}'::jsonb, '{}'::jsonb, 'FUNCTION_CALL', 'act_proposal')",
    )
    .bind(TARGET_DAO)
    .bind(OUTGOING_BLOCK)
    .bind(OUTGOING_TX)
    .execute(&pool)
    .await
    .unwrap();

    // Insert a gas cost record that should NOT be corrected (amount < 0.01)
    sqlx::query(
        "INSERT INTO balance_changes
         (account_id, token_id, block_height, block_timestamp, block_time,
          amount, balance_before, balance_after,
          transaction_hashes, receipt_id, signer_id, receiver_id,
          counterparty, actions, raw_data, action_kind, method_name)
         VALUES ($1, 'near', 190790036, 1774266706024000000, '2026-03-23T11:51:46.024Z',
          0.00005, 1.7726, 1.7727,
          ARRAY[$2], '{}'::text[], 'sponsor.trezu.near', 'olskik.near',
          'olskik.near', '{}'::jsonb, '{}'::jsonb, 'FUNCTION_CALL', 'act_proposal')",
    )
    .bind(TARGET_DAO)
    .bind(OUTGOING_TX)
    .execute(&pool)
    .await
    .unwrap();

    // Verify wrong counterparties
    let (wrong_in, _) = get_near_balance_change(&pool, TARGET_DAO, INCOMING_TX)
        .await
        .unwrap();
    let (wrong_out, _) = get_near_balance_change(&pool, TARGET_DAO, OUTGOING_TX)
        .await
        .unwrap();
    assert_eq!(wrong_in, "yurtur.near");
    assert_eq!(wrong_out, "olskik.near");

    // Run correction (no Goldsky outcomes needed)
    let corrected =
        nt_be::handlers::balance_changes::counterparty_correction::correct_near_counterparties(
            &pool, &network,
        )
        .await
        .unwrap();

    println!("Corrected {} records", corrected);
    assert_eq!(corrected, 2, "Should correct 2 records (not the gas cost)");

    // Verify corrected
    let (fixed_in, _) = get_near_balance_change(&pool, TARGET_DAO, INCOMING_TX)
        .await
        .unwrap();
    let (fixed_out, _) = get_near_balance_change(&pool, TARGET_DAO, OUTGOING_TX)
        .await
        .unwrap();

    println!(
        "Corrected: incoming={} (was {}), outgoing={} (was {})",
        fixed_in, wrong_in, fixed_out, wrong_out
    );

    assert_eq!(fixed_in, SOURCE_DAO);
    assert_eq!(fixed_out, LESIK_DAO);

    // Verify gas cost record was NOT changed
    let gas_record: Option<(String,)> = sqlx::query_as(
        "SELECT counterparty FROM balance_changes
         WHERE account_id = $1 AND block_height = 190790036 AND token_id = 'near'",
    )
    .bind(TARGET_DAO)
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert_eq!(
        gas_record.unwrap().0,
        "olskik.near",
        "Gas cost record should NOT be corrected"
    );

    println!("PASSED");
}
