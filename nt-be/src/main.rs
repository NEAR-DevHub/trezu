use axum::{
    Router,
    http::{HeaderValue, Method, header},
};
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    // Initialize logging
    if std::env::var("RUST_LOG").is_err() {
        unsafe {
            std::env::set_var("RUST_LOG", "info");
        }
    }
    env_logger::init();

    // Initialize application state
    let state = Arc::new(
        nt_be::AppState::new()
            .await
            .expect("Failed to initialize application state"),
    );

    // Spawn account maintenance worker (processes dirty accounts every 5 minutes)
    // Replaces the previous main monitor (30s, all accounts) and dirty monitor (5s poll).
    // Goldsky enrichment worker is now the primary event source for ongoing monitoring.
    if !state.env_vars.disable_balance_monitoring {
        let state_clone = state.clone();
        tokio::spawn(async move {
            use near_api::Chain;
            use nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle;

            let interval_secs = std::env::var("MAINTENANCE_INTERVAL_SECONDS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(300u64); // default 5 minutes
            let initial_delay_secs = std::env::var("MAINTENANCE_INITIAL_DELAY_SECONDS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(30u64);
            let interval = Duration::from_secs(interval_secs);

            log::info!(
                "Starting account maintenance worker ({}s interval, {}s initial delay)",
                interval_secs,
                initial_delay_secs
            );

            // Wait for server to fully start
            tokio::time::sleep(Duration::from_secs(initial_delay_secs)).await;

            let mut interval_timer = tokio::time::interval(interval);

            loop {
                interval_timer.tick().await;

                // Get current block height from the network
                let up_to_block = match Chain::block().fetch_from(&state_clone.network).await {
                    Ok(block) => block.header.height as i64,
                    Err(e) => {
                        log::error!("[maintenance] Failed to get current block height: {}", e);
                        continue;
                    }
                };

                match run_maintenance_cycle(
                    &state_clone.db_pool,
                    &state_clone.archival_network,
                    up_to_block,
                    state_clone.transfer_hint_service.as_deref(),
                    Some((
                        &state_clone.http_client,
                        &state_clone.env_vars.fastnear_api_key,
                    )),
                    state_clone.env_vars.intents_explorer_api_key.as_deref(),
                    &state_clone.env_vars.intents_explorer_api_url,
                    state_clone.neardata_client.as_ref(),
                )
                .await
                {
                    Ok(()) => {}
                    Err(e) => {
                        log::error!("[maintenance] Cycle failed: {}", e);
                    }
                }
            }
        });
    }

    // Spawn background price sync service
    {
        let pool = state.db_pool.clone();
        let http_client = state.http_client.clone();
        let base_url = state.env_vars.defillama_api_base_url.clone();
        tokio::spawn(async move {
            let provider = nt_be::services::DeFiLlamaClient::with_base_url(http_client, base_url);
            nt_be::services::run_price_sync_service(pool, provider).await;
        });
    }

    // TODO: Re-enable once we have a DefiLlama API key or higher rate limit
    // // Spawn usd_value backfill service
    // {
    //     let pool = state.db_pool.clone();
    //     let http_client = state.http_client.clone();
    //     let base_url = state.env_vars.defillama_api_base_url.clone();
    //     tokio::spawn(async move {
    //         let client = nt_be::services::DeFiLlamaClient::with_base_url(http_client, base_url);
    //         nt_be::services::run_usd_value_backfill_service(pool, client).await;
    //     });
    // }

    // Spawn bulk payment payout worker
    {
        let state_clone = state.clone();
        tokio::spawn(async move {
            log::info!("Starting bulk payment payout worker (5 second poll interval)");

            // Wait a bit before first run to let server fully start
            tokio::time::sleep(Duration::from_secs(15)).await;

            let mut interval_timer = tokio::time::interval(Duration::from_secs(5));

            loop {
                interval_timer.tick().await;

                // Query the bulk payment contract for pending lists
                match nt_be::handlers::bulkpayment::worker::query_and_process_pending_lists(
                    &state_clone,
                )
                .await
                {
                    Ok(processed) => {
                        if processed > 0 {
                            log::info!("Processed {} payment batches", processed);
                        }
                    }
                    Err(e) => {
                        log::error!("Payout worker error: {}", e);
                    }
                }
            }
        });
    }

    // Spawn Goldsky enrichment worker (reads from Neon DB, writes to app DB)
    if let Some(neon_pool) = &state.neon_pool {
        let neon_pool = neon_pool.clone();
        let app_pool = state.db_pool.clone();
        let network = state.archival_network.clone();
        let intents_api_key = state.env_vars.intents_explorer_api_key.clone();
        let intents_api_url = state.env_vars.intents_explorer_api_url.clone();
        tokio::spawn(async move {
            use nt_be::handlers::balance_changes::goldsky_enrichment::run_enrichment_cycle;

            const BATCH_SIZE: usize = 100;
            let enrichment_initial_delay = std::env::var("ENRICHMENT_INITIAL_DELAY_SECONDS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(10u64);
            let enrichment_interval = std::env::var("ENRICHMENT_INTERVAL_SECONDS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15u64);
            log::info!(
                "Starting Goldsky enrichment worker ({}s interval, {}s initial delay)",
                enrichment_interval,
                enrichment_initial_delay
            );

            // Wait for server to fully start
            tokio::time::sleep(Duration::from_secs(enrichment_initial_delay)).await;

            loop {
                let should_sleep = {
                    match run_enrichment_cycle(
                        &neon_pool,
                        &app_pool,
                        &network,
                        intents_api_key.as_deref(),
                        &intents_api_url,
                    )
                    .await
                    {
                        Ok(processed) => {
                            if processed > 0 {
                                log::info!(
                                    "[goldsky-enrichment] Processed {} outcomes this cycle",
                                    processed
                                );
                            }
                            // If batch was full, there's likely more data — skip the sleep
                            processed < BATCH_SIZE
                        }
                        Err(e) => {
                            log::error!("[goldsky-enrichment] Enrichment cycle failed: {}", e);
                            true
                        }
                    }
                };
                if should_sleep {
                    tokio::time::sleep(Duration::from_secs(enrichment_interval)).await;
                }
            }
        });
    } else {
        log::info!("Goldsky enrichment worker disabled (NEON_DATABASE_URL not set)");
    }

    // Spawn DAO list sync service (fetches DAOs from sputnik-dao.near every 5 minutes)
    {
        let pool = state.db_pool.clone();
        let network = state.network.clone();
        tokio::spawn(async move {
            nt_be::services::run_dao_list_sync_service(pool, network).await;
        });
    }

    // Spawn DAO policy sync service (processes dirty/stale DAOs to extract members)
    {
        let pool = state.db_pool.clone();
        let network = state.network.clone();
        tokio::spawn(async move {
            nt_be::services::run_dao_policy_sync_service(pool, network).await;
        });
    }

    // Spawn subscription monthly credit reset service
    {
        let pool = state.db_pool.clone();
        tokio::spawn(async move {
            nt_be::handlers::subscription::run_monthly_plan_reset_service(pool).await;
        });
    }

    // Configure CORS - must specify exact origins, methods, and headers when using credentials
    let origins: Vec<HeaderValue> = state
        .env_vars
        .cors_allowed_origins
        .iter()
        .filter_map(|s| s.parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            header::ORIGIN,
            header::COOKIE,
        ])
        .allow_credentials(true);

    let app = Router::new()
        .merge(nt_be::routes::create_routes(state))
        .layer(cors);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3002".to_string());
    let addr = format!("0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    println!("Server running on {}", addr);

    axum::serve(listener, app).await.unwrap();
}
