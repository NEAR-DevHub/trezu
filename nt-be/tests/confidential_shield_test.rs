//! Integration tests for confidential shield endpoints.
//!
//! Uses TestServer (real nt-be binary) to verify auth requirements
//! and endpoint availability.

mod common;

use common::TestServer;

#[tokio::test]
async fn test_confidential_quote_requires_auth() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(server.url("/api/confidential-intents/quote"))
        .json(&serde_json::json!({
            "daoId": "test.sputnik-dao.near",
            "originAsset": "nep141:wrap.near",
            "destinationAsset": "nep141:wrap.near",
            "amount": "10000000000000000000000",
            "deadline": "2099-01-01T00:00:00Z",
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401, "Confidential quote should require auth");
}

#[tokio::test]
async fn test_confidential_generate_intent_requires_auth() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(server.url("/api/confidential-intents/generate-intent"))
        .json(&serde_json::json!({
            "type": "swap_transfer",
            "standard": "nep413",
            "depositAddress": "abc123",
            "signerId": "test.sputnik-dao.near",
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        401,
        "Confidential generate-intent should require auth"
    );
}

#[tokio::test]
async fn test_confidential_submit_intent_requires_auth() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(server.url("/api/confidential-intents/submit-intent"))
        .json(&serde_json::json!({
            "daoId": "test.sputnik-dao.near",
            "type": "swap_transfer",
            "signedData": {"bad": "data"},
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        401,
        "Confidential submit-intent should require auth"
    );
}

#[tokio::test]
async fn test_confidential_balances_requires_auth() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(server.url("/api/confidential-intents/balances?daoId=test.sputnik-dao.near"))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        401,
        "Confidential balances should require auth"
    );
}

#[tokio::test]
async fn test_confidential_prepare_auth_requires_auth() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(server.url("/api/confidential-intents/prepare-auth"))
        .json(&serde_json::json!({
            "daoId": "test.sputnik-dao.near",
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        401,
        "Confidential prepare-auth should require auth"
    );
}

#[tokio::test]
async fn test_confidential_authenticate_requires_auth() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(server.url("/api/confidential-intents/authenticate"))
        .json(&serde_json::json!({
            "daoId": "test.sputnik-dao.near",
            "signedData": {"bad": "data"},
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        401,
        "Confidential authenticate should require auth"
    );
}
