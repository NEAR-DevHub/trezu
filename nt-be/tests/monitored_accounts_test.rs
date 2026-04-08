mod common;

use chrono::{DateTime, Datelike, Months, Utc};
use common::TestServer;

#[tokio::test]
async fn test_monitored_accounts_crud() {
    common::load_test_env();

    // Start the actual server
    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    // Test 1: Add a monitored account
    // Note: AddAccountRequest uses camelCase deserialization
    let add_payload = serde_json::json!({
        "accountId": "test-treasury.sputnik-dao.near"
    });

    let response = client
        .post(server.url("/api/monitored-accounts"))
        .json(&add_payload)
        .send()
        .await
        .expect("Failed to add account");

    assert_eq!(response.status(), 200, "Add account should succeed");
    // AddAccountResponse uses camelCase serialization
    let added: serde_json::Value = response.json().await.expect("Failed to parse JSON");
    assert_eq!(added["accountId"], "test-treasury.sputnik-dao.near");
    assert_eq!(added["enabled"], true);
    assert!(added["createdAt"].is_string());
    assert!(added["updatedAt"].is_string());
    let credits_reset_at = DateTime::parse_from_rfc3339(
        added["creditsResetAt"]
            .as_str()
            .expect("creditsResetAt should be a string"),
    )
    .expect("creditsResetAt should be a valid RFC3339 datetime")
    .with_timezone(&Utc);

    let now = Utc::now();
    let expected_reset_at = DateTime::<Utc>::from_naive_utc_and_offset(
        now.date_naive()
            .with_day(1)
            .expect("day 1 should always be valid")
            .and_hms_opt(0, 0, 0)
            .expect("00:00:00 should always be valid")
            .checked_add_months(Months::new(1))
            .expect("adding one month should always be valid"),
        Utc,
    );
    assert_eq!(
        credits_reset_at, expected_reset_at,
        "New account should have credits_reset_at at next UTC month start"
    );
}
