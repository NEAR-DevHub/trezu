//! Integration tests for confidential shield endpoints.
//!
//! Uses TestServer (real nt-be binary) to verify auth requirements
//! and authenticated access.

mod common;

use common::TestServer;
use serial_test::serial;

#[tokio::test]
#[serial]
async fn test_confidential_endpoints() {
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    // ── All confidential endpoints require auth ──

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
    assert_eq!(
        resp.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "quote should require auth"
    );

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
        reqwest::StatusCode::UNAUTHORIZED,
        "generate-intent should require auth"
    );

    let resp = client
        .get(server.url("/api/confidential-intents/balances?daoId=test.sputnik-dao.near"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "balances should require auth"
    );

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
        reqwest::StatusCode::UNAUTHORIZED,
        "prepare-auth should require auth"
    );

    // ── With auth: prepare-auth should succeed (returns proposal args) ──

    // Create a valid auth session
    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
    let pool = sqlx::PgPool::connect(&db_url)
        .await
        .expect("Failed to connect to test DB");

    let account_id = "test.near";
    let dao_id = "test.sputnik-dao.near";

    // Insert user
    sqlx::query("INSERT INTO users (account_id, terms_accepted_at) VALUES ($1, NOW()) ON CONFLICT (account_id) DO NOTHING")
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    // Insert DAO member
    sqlx::query("INSERT INTO dao_members (account_id, dao_id, is_policy_member) VALUES ($1, $2, true) ON CONFLICT DO NOTHING")
        .bind(account_id)
        .bind(dao_id)
        .execute(&pool)
        .await
        .unwrap();

    // Insert monitored account
    sqlx::query("INSERT INTO monitored_accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(dao_id)
        .execute(&pool)
        .await
        .unwrap();

    // Create JWT using the test secret
    let jwt = common::create_test_jwt(account_id);

    // Insert session
    use sha2::Digest;
    let token_hash = hex::encode(sha2::Sha256::digest(jwt.as_bytes()));
    sqlx::query("INSERT INTO user_sessions (user_id, token_hash, expires_at) SELECT id, $1, NOW() + INTERVAL '1 day' FROM users WHERE account_id = $2 ON CONFLICT (token_hash) DO NOTHING")
        .bind(&token_hash)
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    pool.close().await;

    // Call prepare-auth with valid JWT cookie
    let resp = client
        .post(server.url("/api/confidential-intents/prepare-auth"))
        .header(reqwest::header::COOKIE, format!("auth_token={}", jwt))
        .json(&serde_json::json!({
            "daoId": dao_id,
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::OK,
        "prepare-auth should succeed with valid auth: {}",
        resp.text().await.unwrap_or_default()
    );
}
