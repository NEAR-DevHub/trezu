mod common;

use std::sync::Arc;

use axum::{body::Body, http::Request};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test]
async fn test_public_dashboard_aum_returns_latest_snapshot(pool: PgPool) -> sqlx::Result<()> {
    common::load_test_env();

    sqlx::query(
        r#"
        INSERT INTO public_dashboard_daily_runs (snapshot_date, dao_count, failed_dao_count, computed_at)
        VALUES
            ('2026-03-24', 2, 0, NOW()),
            ('2026-03-25', 3, 1, NOW())
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO public_dashboard_daily_balances (
            snapshot_date,
            dao_id,
            token_id,
            symbol,
            name,
            icon,
            decimals,
            total_amount_raw,
            price_usd,
            total_usd
        )
        VALUES
            ('2026-03-25', 'dao-1.sputnik-dao.near', 'near', 'NEAR', 'NEAR', 'https://example.com/near.png', 24, 2500000000000000000000000, 3, 7.5),
            ('2026-03-25', 'dao-2.sputnik-dao.near', 'near', 'NEAR', 'NEAR', 'https://example.com/near.png', 24, 1500000000000000000000000, 3, 4.5),
            ('2026-03-25', 'dao-3.sputnik-dao.near', 'usdc', 'USDC', 'USDC', NULL, 6, 4500000, 1, 4.5)
        "#,
    )
    .execute(&pool)
    .await?;

    let app_state = nt_be::AppState::builder()
        .db_pool(pool.clone())
        .build()
        .await
        .map_err(|err| sqlx::Error::Io(std::io::Error::other(err.to_string())))?;
    let app = nt_be::routes::create_routes(Arc::new(app_state));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/public/dashboard/aum")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("request should succeed");

    assert_eq!(response.status(), axum::http::StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body should read");
    let payload: Value = serde_json::from_slice(&body).expect("response should be valid JSON");

    assert_eq!(payload["snapshotDate"], "2026-03-25");
    assert_eq!(payload["daoCount"], 3);
    assert_eq!(payload["totalAumUsd"], "16.5");
    assert!(
        payload.get("daoId").is_none(),
        "public payload must not expose a top-level daoId"
    );
    assert!(
        payload.get("trezuDaoCount").is_none(),
        "public payload must not expose trezuDaoCount"
    );
    assert_eq!(payload["topTokens"].as_array().map(Vec::len), Some(2));
    assert_eq!(payload["topTokens"][0]["rank"], 1);
    assert_eq!(payload["topTokens"][0]["tokenId"], "near");
    assert_eq!(payload["topTokens"][0]["totalUsd"], "12");
    assert!(
        payload["topTokens"][0].get("daoId").is_none(),
        "public top token rows must not expose daoId"
    );
    assert_eq!(payload["topTokens"][1]["rank"], 2);
    assert_eq!(payload["topTokens"][1]["tokenId"], "usdc");

    Ok(())
}
