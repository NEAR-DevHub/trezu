use std::sync::Arc;

use near_account_id::AccountIdRef;
use reqwest::StatusCode;
use serde_json::Value;
use sqlx::PgPool;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::client::{QUOTES_PATH, WITHDRAWALS_PATH};
use super::repository::store_cached;
use super::types::{ANY_INPUT_DESTINATION_ASSET, ANY_INPUT_ORIGIN_ASSET};
use super::*;
use crate::AppState;
use crate::services::{CredentialScope, TokenBundle, TokenKeyring};
use crate::utils::test_utils::build_test_state;

const DAO: &str = "rda-test.sputnik-dao.near";
const JWT: &str = "rda-access-token";
const KEYRING: &str =
    r#"{"active":"k1","keys":{"k1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}}"#;

fn keyring() -> TokenKeyring {
    TokenKeyring::parse(KEYRING).expect("valid test keyring")
}

async fn seed_authenticated_dao(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO monitored_accounts (account_id, is_confidential_account) VALUES ($1, TRUE)",
    )
    .bind(DAO)
    .execute(pool)
    .await
    .expect("seed account");
    let envelope = keyring()
        .encrypt(
            DAO,
            CredentialScope::Dao,
            &TokenBundle {
                access_token: JWT.to_string(),
                refresh_token: "rda-refresh".to_string(),
            },
        )
        .expect("encrypt envelope");
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_credentials_enc = $1,
            confidential_token_expires_at = NOW() + INTERVAL '1 hour'
        WHERE account_id = $2
        "#,
    )
    .bind(envelope)
    .bind(DAO)
    .execute(pool)
    .await
    .expect("seed tokens");
}

fn state_with_mock(pool: PgPool, mock: &MockServer) -> Arc<AppState> {
    let mut state = build_test_state(pool);
    state.env_vars.confidential_api_url = mock.uri();
    state.env_vars.oneclick_api_key = Some("test-key".to_string());
    state.confidential_keyring = Some(Arc::new(keyring()));
    Arc::new(state)
}

fn quote_json(recipient: &str) -> Value {
    serde_json::json!({
        "depositAddress": "rda-monitoring-account",
        "depositMemo": null,
        "chainDepositAddresses": [
            { "blockchain": "near", "address": "rda-near-funding" },
            { "blockchain": "base", "address": "0xbase" },
            { "blockchain": "stellar", "address": "GSTELLAR", "memo": "123" }
        ],
        "recipient": recipient,
        "refundTo": recipient,
        "originAsset": ANY_INPUT_ORIGIN_ASSET,
        "destinationAsset": ANY_INPUT_DESTINATION_ASSET,
        "confidentiality": "basic"
    })
}

/// An ANY_INPUT quote that is not a deposit set (asset-specific fee
/// collection): skipped by discovery, never a conflict.
fn fee_quote_json() -> Value {
    let mut quote = quote_json(DAO);
    quote["originAsset"] = Value::String("nep141:wrap.near".to_string());
    quote
}

fn listing(items: Vec<Value>, next: Option<&str>) -> Value {
    serde_json::json!({ "data": items, "links": { "next": next } })
}

fn listed(id: &str, attributes: Value) -> Value {
    serde_json::json!({ "type": "quotes", "id": id, "attributes": attributes })
}

#[test]
fn chain_entries_map_to_bridge_chain_ids() {
    let entry = |blockchain: &str| ChainDepositAddress {
        blockchain: blockchain.to_string(),
        address: "x".to_string(),
        memo: None,
    };
    assert_eq!(entry("base").bridge_chain_id(), "eth:8453");
    assert_eq!(entry("arb").bridge_chain_id(), "eth:42161");
    assert_eq!(entry("eth").bridge_chain_id(), "eth:1");
    assert_eq!(entry("btc").bridge_chain_id(), "btc:mainnet");
    assert_eq!(entry("sol").bridge_chain_id(), "sol:mainnet");
    assert_eq!(entry("near").bridge_chain_id(), "near:mainnet");
    assert_eq!(entry("hypercore").bridge_chain_id(), "hypercore:mainnet");
    assert_eq!(entry("pol").bridge_chain_id(), "eth:137");
}

#[test]
fn set_parses_from_quote_and_selects_by_chain() {
    let set = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();
    assert_eq!(set.quote_deposit_address, "rda-monitoring-account");
    assert_eq!(
        set.address_for_chain("eth:8453")
            .map(|e| e.address.as_str()),
        Some("0xbase")
    );
    assert_eq!(
        set.address_for_chain("stellar:mainnet")
            .and_then(|e| e.memo.as_deref()),
        Some("123")
    );
    assert!(set.address_for_chain("btc:mainnet").is_none());
    assert!(set.owns_address("rda-monitoring-account"));
    assert!(set.owns_address("0xbase"));
    assert!(!set.owns_address("someone-else"));
}

#[test]
fn set_rejects_quotes_without_funding_addresses() {
    let mut quote = quote_json(DAO);
    quote["chainDepositAddresses"] = serde_json::json!([]);
    assert!(ReusableDepositAddresses::from_quote(&quote, None, None).is_err());
    let mut quote = quote_json(DAO);
    quote["chainDepositAddresses"] = serde_json::json!([
        { "blockchain": "near", "address": "a" },
        { "blockchain": "near", "address": "b" }
    ]);
    assert!(ReusableDepositAddresses::from_quote(&quote, None, None).is_err());
}

#[sqlx::test]
async fn resolve_uses_the_listed_set_and_caches_it(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .and(query_param("filter[swapType]", "ANY_INPUT"))
        .and(header("Authorization", format!("Bearer {JWT}").as_str()))
        .and(header("x-api-key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(listing(
            vec![
                listed("other", quote_json("someone-else.near")),
                listed("mine", quote_json(DAO)),
            ],
            None,
        )))
        .expect(1)
        .mount(&mock)
        .await;
    Mock::given(method("POST"))
        .and(path("/v0/quote"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);

    let dao = AccountIdRef::new(DAO).unwrap();
    let set = ReusableDepositResolver::new(&state)
        .resolve(dao)
        .await
        .expect("resolve");
    assert_eq!(set.quote_id.as_deref(), Some("mine"));
    assert_eq!(set.chain_deposit_addresses.len(), 3);

    let again = ReusableDepositResolver::new(&state)
        .resolve(dao)
        .await
        .expect("cached resolve");
    assert_eq!(again, set);
    assert_eq!(load_cached(&pool, DAO).await.unwrap(), Some(set));
}

/// Cache `set` as confirmed `age` (a Postgres interval) ago.
async fn seed_cached(pool: &PgPool, set: &ReusableDepositAddresses, age: &str) {
    store_cached(pool, DAO, set).await.expect("cache set");
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_reusable_deposit_updated_at = NOW() - $2::interval
        WHERE account_id = $1
        "#,
    )
    .bind(DAO)
    .bind(age)
    .execute(pool)
    .await
    .expect("age cache");
}

fn rotated_quote_json() -> Value {
    let mut quote = quote_json(DAO);
    quote["depositAddress"] = Value::String("rda-rotated-account".to_string());
    quote
}

#[sqlx::test]
async fn stale_cache_is_reverified_and_replaced(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .and(header("Authorization", format!("Bearer {JWT}").as_str()))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(listing(vec![listed("rotated", rotated_quote_json())], None)),
        )
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let old = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();
    seed_cached(&pool, &old, "2 days").await;
    let state = state_with_mock(pool.clone(), &mock);
    let dao = AccountIdRef::new(DAO).unwrap();

    let set = ReusableDepositResolver::new(&state)
        .resolve(dao)
        .await
        .expect("resolve");
    assert_eq!(set.quote_deposit_address, "rda-rotated-account");
    assert_eq!(set.quote_id.as_deref(), Some("rotated"));

    // Confirmed just now: served from the cache without another listing.
    let again = ReusableDepositResolver::new(&state)
        .resolve(dao)
        .await
        .expect("cached resolve");
    assert_eq!(again, set);
}

#[sqlx::test]
async fn stale_cache_is_served_when_oneclick_fails(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path(WITHDRAWALS_PATH))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let old = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();
    seed_cached(&pool, &old, "2 days").await;
    let state = state_with_mock(pool.clone(), &mock);

    let set = ReusableDepositResolver::new(&state)
        .resolve(AccountIdRef::new(DAO).unwrap())
        .await
        .expect("cached set survives a 1Click outage");
    assert_eq!(set, old);
}

/// Re-verify finds only an incompatible set and 1Click no longer answers
/// for the cached address: the cached set is dropped, not served.
#[sqlx::test]
async fn dead_cached_set_is_cleared_not_served(pool: PgPool) {
    let mock = MockServer::start().await;
    let mut public = quote_json(DAO);
    public["confidentiality"] = Value::String("public".to_string());
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(listing(vec![listed("theirs", public)], None)),
        )
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path(WITHDRAWALS_PATH))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(serde_json::json!({ "message": "quote not found" })),
        )
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let old = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();
    seed_cached(&pool, &old, "2 days").await;
    let state = state_with_mock(pool.clone(), &mock);

    let (status, _) = ReusableDepositResolver::new(&state)
        .resolve(AccountIdRef::new(DAO).unwrap())
        .await
        .expect_err("dead set is not served");
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(load_cached(&pool, DAO).await.unwrap(), None);
}

#[sqlx::test]
async fn refresh_is_debounced_then_relists(pool: PgPool) {
    let mock = MockServer::start().await;
    let mut wider = quote_json(DAO);
    wider["chainDepositAddresses"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({ "blockchain": "sol", "address": "SOLADDR" }));
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(listing(vec![listed("mine", wider)], None)),
        )
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let cached = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();
    seed_cached(&pool, &cached, "10 seconds").await;
    let state = state_with_mock(pool.clone(), &mock);
    let dao = AccountIdRef::new(DAO).unwrap();
    let resolver = ReusableDepositResolver::new(&state);

    let debounced = resolver.refresh(dao).await.expect("debounced refresh");
    assert_eq!(debounced, cached);
    assert!(debounced.address_for_chain("sol:mainnet").is_none());

    seed_cached(&pool, &cached, "5 minutes").await;
    let fresh = resolver.refresh(dao).await.expect("refresh");
    assert_eq!(fresh.chain_deposit_addresses.len(), 4);
    assert!(fresh.address_for_chain("sol:mainnet").is_some());
    assert_eq!(load_cached(&pool, DAO).await.unwrap(), Some(fresh));
}

#[sqlx::test]
async fn withdrawals_page_is_requested_by_number(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(WITHDRAWALS_PATH))
        .and(query_param("page", "3"))
        .and(query_param("limit", "50"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "asset": "1cs_v1:original",
            "recipient": DAO,
            "withdrawals": []
        })))
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);
    let set = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();

    let page = ReusableDepositResolver::new(&state)
        .withdrawals_page(AccountIdRef::new(DAO).unwrap(), &set, 3)
        .await
        .expect("page 3");
    assert!(page.withdrawals.is_empty());
}

#[sqlx::test]
async fn withdrawals_not_found_is_a_stale_set(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(WITHDRAWALS_PATH))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(serde_json::json!({ "message": "quote not found" })),
        )
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);
    let set = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();

    let error = ReusableDepositResolver::new(&state)
        .withdrawals(AccountIdRef::new(DAO).unwrap(), &set)
        .await
        .expect_err("stale");
    assert!(matches!(error, WithdrawalsError::StaleSet(_)), "{error}");
}

#[sqlx::test]
async fn resolve_follows_pagination_then_creates(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .and(query_param("page[after]", "c1"))
        // Mounted first: wiremock answers with the first matching mock.
        .respond_with(ResponseTemplate::new(200).set_body_json(listing(vec![], None)))
        .expect(1)
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .and(query_param("filter[swapType]", "ANY_INPUT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(listing(
            vec![listed("fee-collector", fee_quote_json())],
            Some("/v0/quotes?filter[swapType]=ANY_INPUT&page[after]=c1"),
        )))
        .expect(1)
        .mount(&mock)
        .await;
    Mock::given(method("POST"))
        .and(path("/v0/quote"))
        .and(header("Authorization", format!("Bearer {JWT}").as_str()))
        .and(wiremock::matchers::body_partial_json(serde_json::json!({
            "swapType": "ANY_INPUT",
            "originAsset": ANY_INPUT_ORIGIN_ASSET,
            "destinationAsset": ANY_INPUT_DESTINATION_ASSET,
            "recipient": DAO,
            "refundTo": DAO,
            "confidentiality": "basic",
            "deadline": REUSABLE_QUOTE_DEADLINE,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "correlationId": "corr-1",
            "timestamp": "2026-10-28T00:00:00.000Z",
            "quote": quote_json(DAO),
        })))
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);

    let set = ReusableDepositResolver::new(&state)
        .resolve(AccountIdRef::new(DAO).unwrap())
        .await
        .expect("resolve");
    assert_eq!(set.correlation_id.as_deref(), Some("corr-1"));
    assert!(set.quote_id.is_none());
    assert_eq!(set.quote_deposit_address, "rda-monitoring-account");
}

#[sqlx::test]
async fn create_rejection_falls_back_to_a_second_listing(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(listing(vec![], None)))
        .up_to_n_times(1)
        .mount(&mock)
        .await;
    Mock::given(method("POST"))
        .and(path("/v0/quote"))
        .respond_with(
            ResponseTemplate::new(400)
                .set_body_json(serde_json::json!({ "message": "quote already exists" })),
        )
        .expect(1)
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(listing(vec![listed("late", quote_json(DAO))], None)),
        )
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);

    let set = ReusableDepositResolver::new(&state)
        .resolve(AccountIdRef::new(DAO).unwrap())
        .await
        .expect("resolve");
    assert_eq!(set.quote_id.as_deref(), Some("late"));
}

#[sqlx::test]
async fn incompatible_existing_set_is_a_conflict(pool: PgPool) {
    let mock = MockServer::start().await;
    let mut public = quote_json(DAO);
    public["confidentiality"] = Value::String("public".to_string());
    Mock::given(method("GET"))
        .and(path(QUOTES_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(listing(vec![listed("public", public)], None)),
        )
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);

    let error = ReusableDepositResolver::new(&state)
        .resolve(AccountIdRef::new(DAO).unwrap())
        .await
        .expect_err("conflict");
    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(load_cached(&pool, DAO).await.unwrap().is_none());
}

#[test]
fn processing_payout_keeps_its_key_once_it_succeeds() {
    let page: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
        "asset": "1cs_v1:original",
        "recipient": DAO,
        "withdrawals": [
            { "status": "PROCESSING", "amountOutFormatted": "0.2",
              "timestamp": "2026-10-30T09:48:25.342Z", "hash": "" },
            { "status": "SUCCESS", "amountOutFormatted": "0.2",
              "timestamp": "2026-10-30T09:48:25.342Z", "hash": "E9MM" }
        ]
    }))
    .unwrap();
    let [processing, success] = page.withdrawals.as_slice() else {
        panic!("two payouts");
    };
    assert_eq!(
        processing.provider_deposit_key(),
        success.provider_deposit_key()
    );
    assert_eq!(processing.payout_hash(), None);
    assert_eq!(success.payout_hash().as_deref(), Some("E9MM"));
}

#[test]
fn withdrawals_accept_one_object_or_an_array() {
    let one: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
        "asset": "1cs_v1:original",
        "recipient": DAO,
        "withdrawals": {
            "status": "SUCCESS", "amountOutFormatted": "0.5",
            "timestamp": "2026-10-28T10:00:00.000Z", "hash": "h1"
        }
    }))
    .unwrap();
    assert_eq!(one.withdrawals.len(), 1);
    assert_eq!(
        one.withdrawals[0].provider_deposit_key(),
        "rda:2026-10-28T10:00:00+00:00"
    );
    assert_eq!(
        one.withdrawals[0].amount(),
        Some("0.5".parse::<bigdecimal::BigDecimal>().unwrap())
    );
    let many: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
        "asset": "1cs_v1:original",
        "recipient": DAO,
        "withdrawals": [
            { "status": "SUCCESS", "amountOutFormatted": "1", "timestamp": "2026-10-28T10:00:00Z", "hash": "a" },
            { "status": "FAILED", "amountOutFormatted": "2", "timestamp": "2026-10-28T09:00:00Z", "hash": "b" }
        ]
    }))
    .unwrap();
    assert_eq!(many.withdrawals.len(), 2);
    assert!(many.withdrawals[0].is_success());
    assert!(many.withdrawals[1].is_failed());
    let none: ReusableWithdrawals = serde_json::from_value(serde_json::json!({
        "asset": "1cs_v1:original", "recipient": DAO
    }))
    .unwrap();
    assert!(none.withdrawals.is_empty());
}

#[sqlx::test]
async fn withdrawals_are_read_for_the_quote_address_with_the_dao_jwt(pool: PgPool) {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(WITHDRAWALS_PATH))
        .and(query_param("depositAddress", "rda-monitoring-account"))
        .and(query_param("limit", "50"))
        .and(query_param("sortOrder", "desc"))
        .and(header("Authorization", format!("Bearer {JWT}").as_str()))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "asset": "1cs_v1:original",
            "recipient": DAO,
            "affiliateRecipient": "",
            "withdrawals": [{
                "status": "SUCCESS", "amountOut": "500000", "amountOutFormatted": "0.5",
                "amountOutUsd": "0.5", "withdrawFee": "0", "withdrawFeeFormatted": "0",
                "withdrawFeeUsd": "0", "timestamp": "2026-10-28T10:00:00.000Z", "hash": "payout-1"
            }]
        })))
        .expect(1)
        .mount(&mock)
        .await;
    seed_authenticated_dao(&pool).await;
    let state = state_with_mock(pool.clone(), &mock);
    let set = ReusableDepositAddresses::from_quote(&quote_json(DAO), None, None).unwrap();

    let page = ReusableDepositResolver::new(&state)
        .withdrawals(AccountIdRef::new(DAO).unwrap(), &set)
        .await
        .expect("withdrawals");
    assert_eq!(page.withdrawals.len(), 1);
    assert_eq!(page.withdrawals[0].hash, "payout-1");
}
