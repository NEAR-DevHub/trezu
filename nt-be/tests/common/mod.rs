#![allow(dead_code)]

use near_api::{NetworkConfig, RPCEndpoint, Signer};
use nt_be::AppState;
use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::{Arc, Once};
use std::time::Duration;
use tokio::time::sleep;

/// Create a JWT for integration tests using the test JWT secret.
pub fn create_test_jwt(account_id: &str) -> String {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "test-jwt-secret".to_string());
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::hours(24);

    let header =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        serde_json::json!({
            "sub": account_id,
            "exp": exp.timestamp(),
            "iat": now.timestamp(),
        })
        .to_string(),
    );

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(jwt_secret.as_bytes()).unwrap();
    mac.update(format!("{}.{}", header, payload).as_bytes());
    let sig = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    format!("{}.{}.{}", header, payload, sig)
}

static INIT: Once = Once::new();

/// Load test environment variables. Safe to call multiple times - only runs once.
/// Preserves environment variables supplied by the test runner. Otherwise,
/// loads `.env.test` first so test values take precedence, then fills any
/// missing values from `.env`.
///
/// NOTE: Keep in sync with `src/utils/test_utils.rs::load_test_env()` which serves
/// unit tests. Integration tests can't access #[cfg(test)] items from the library.
pub fn load_test_env() {
    INIT.call_once(|| {
        dotenvy::from_filename(".env.test").ok();
        dotenvy::from_filename(".env").ok();
    });
}

/// Create archival network config for tests with fastnear API key.
/// Respects NEAR_ARCHIVAL_RPC_URL env var for proxy/cache override.
pub fn create_archival_network() -> NetworkConfig {
    load_test_env();

    let fastnear_api_key =
        std::env::var("FASTNEAR_API_KEY").expect("FASTNEAR_API_KEY must be set in .env");

    let rpc_url = std::env::var("NEAR_ARCHIVAL_RPC_URL")
        .unwrap_or_else(|_| "https://archival-rpc.mainnet.fastnear.com/".to_string());

    NetworkConfig {
        rpc_endpoints: vec![
            RPCEndpoint::new(rpc_url.parse().unwrap()).with_api_key(fastnear_api_key),
        ],
        ..NetworkConfig::mainnet()
    }
}

/// Get the FastNear API key for authenticated requests
pub fn get_fastnear_api_key() -> String {
    load_test_env();
    std::env::var("FASTNEAR_API_KEY").expect("FASTNEAR_API_KEY must be set in .env")
}

/// Whether tests that hit *live* production endpoints directly (not via the
/// offline RPC cache proxy) may run. These verify external-infrastructure
/// behavior — e.g. cross-provider RPC parity — so they need real network
/// access and a real authenticated FastNear key, neither of which fork PRs
/// have (secrets aren't shared with forks). CI sets `FASTNEAR_LIVE_TESTS` to
/// `disabled` when the real secret is absent; everywhere else (local dev,
/// internal CI with the secret) it defaults to enabled.
pub fn live_production_tests_enabled() -> bool {
    load_test_env();
    std::env::var("FASTNEAR_LIVE_TESTS").as_deref() != Ok("disabled")
}

/// Build a test AppState whose primary `network` is the archival endpoint.
///
/// Most integration tests replay historical blocks that the current-head RPC
/// has pruned, so `run_maintenance_cycle` (which uses `state.network`) needs
/// to hit the archival RPC. Prefer this over [`build_test_state`] for any
/// test that calls the maintenance cycle against old blocks.
pub fn build_test_state_archival(db_pool: sqlx::PgPool) -> AppState {
    let mut state = build_test_state(db_pool);
    state.network = state.archival_network.clone();
    state
}

/// Build a full AppState for integration tests that need dirty monitor, etc.
///
/// Mirrors `src/utils/test_utils.rs::build_test_state()` but accessible from
/// integration tests (which can't use #[cfg(test)] items from the library).
pub fn build_test_state(db_pool: sqlx::PgPool) -> AppState {
    load_test_env();

    let env_vars = nt_be::utils::env::EnvVars::default();
    let http_client = reqwest::Client::new();

    let rpc_url = env_vars
        .near_rpc_url
        .clone()
        .unwrap_or_else(|| "https://rpc.mainnet.fastnear.com/".to_string());
    let archival_rpc_url = env_vars
        .near_archival_rpc_url
        .clone()
        .unwrap_or_else(|| "https://archival-rpc.mainnet.fastnear.com/".to_string());

    let network = NetworkConfig {
        rpc_endpoints: vec![
            RPCEndpoint::new(rpc_url.parse().unwrap())
                .with_api_key(env_vars.fastnear_api_key.clone()),
        ],
        ..NetworkConfig::mainnet()
    };

    let archival_network = NetworkConfig {
        rpc_endpoints: vec![
            RPCEndpoint::new(archival_rpc_url.parse().unwrap())
                .with_api_key(env_vars.fastnear_api_key.clone()),
        ],
        ..NetworkConfig::mainnet()
    };

    // Drop the driver so the gate fails open (no rate limiting in tests, matching
    // the old effectively-unlimited test limiter) without spawning a background task.
    let (nearblocks_gate, _) = nt_be::utils::priority_rate_gate::PriorityRateGate::<
        nt_be::handlers::public_history::bronze::NearblocksPriority,
    >::new(nt_be::utils::rate_limiter::RateLimiter::per_minute(
        "nearblocks-test",
        10_000,
        10_000,
    ));

    let (event_tx, _) = tokio::sync::broadcast::channel(nt_be::events::EVENT_BUS_CAPACITY);

    AppState {
        cache: nt_be::utils::cache::Cache::new(),
        telegram_client: nt_be::utils::telegram::TelegramClient::default(),
        http_client,
        nearblocks_gate,
        defillama_limiter: nt_be::utils::rate_limiter::RateLimiter::per_minute(
            "defillama-test",
            10_000,
            10_000,
        ),
        signer: Signer::from_secret_key(env_vars.signer_key.clone())
            .expect("Failed to create signer."),
        bulk_payment_signer: Signer::from_secret_key(env_vars.bulk_payment_signer.clone())
            .expect("Failed to create bulk payment signer"),
        signer_id: env_vars.signer_id.clone(),
        network,
        archival_network,
        bulk_payment_contract_id: env_vars.bulk_payment_contract_id.clone(),
        env_vars,
        token_price_service: Arc::new(nt_be::services::TokenPriceService::new(db_pool.clone())),
        db_pool,
        goldsky_pool: None,
        confidential_keyring: None,
        event_tx,
        background_jobs_status: Arc::new(nt_be::jobs::leadership::BackgroundJobsStatus::new()),
        creation_sweep_notify: Arc::new(tokio::sync::Notify::new()),
    }
}

pub struct TestServer {
    process: Child,
    port: u16,
}

fn available_local_port() -> u16 {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral local test port");
    listener
        .local_addr()
        .expect("Failed to read local test port")
        .port()
}

impl TestServer {
    pub async fn start() -> Self {
        load_test_env();

        let db_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

        let port = available_local_port();

        // Start the pre-built server binary directly (not `cargo run`) to avoid
        // blocking on the cargo build lock when called from within `cargo test`.
        // Clear proxy env vars so the server uses real RPC endpoints (not the test proxy).
        let mut process = Command::new(env!("CARGO_BIN_EXE_nt-be"))
            .env("PORT", port.to_string())
            .env("RUST_LOG", "info")
            .env("DATABASE_URL", &db_url) // Override with test database
            .env(
                "SIGNER_KEY",
                "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB",
            )
            .env("SIGNER_ID", "sandbox")
            .env("GOLDSKY_DATABASE_URL", "")
            .env("NEARBLOCKS_API_KEY", "")
            .env_remove("NEAR_RPC_URL")
            .env_remove("NEAR_ARCHIVAL_RPC_URL")
            .env_remove("INTENTS_EXPLORER_API_URL")
            .spawn()
            .expect("Failed to start server");

        // Wait for server to be ready
        let client = reqwest::Client::new();
        for attempt in 0..60 {
            if attempt % 10 == 0 && attempt > 0 {
                println!("Still waiting for server... (attempt {}/60)", attempt);
            }
            sleep(Duration::from_millis(500)).await;
            if let Ok(response) = client
                .get(format!("http://localhost:{}/api/health", port))
                .send()
                .await
                && response.status().is_success()
            {
                println!("Server ready after {} attempts", attempt + 1);
                return TestServer { process, port };
            }
        }

        // Kill process before panicking to avoid zombie
        let _ = process.kill();
        let _ = process.wait();
        panic!("Server failed to start within timeout");
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://localhost:{}{}", self.port, path)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}
