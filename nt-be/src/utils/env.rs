use near_api::{AccountId, SecretKey};
use std::collections::HashSet;

/// Backing source for treasury balance reads (`/api/user/assets`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BalanceReadSource {
    /// Live reads: FastNear discovery + RPC for public treasuries (with
    /// verified ledger heads overriding), the 1Click API for confidential.
    Live,
    /// Ledger heads only. For public treasuries this is the backup switch
    /// for FastNear history API outages (never-verified treasuries stay on
    /// the live path); for confidential it is the default, with live 1Click
    /// reads only for DAOs with no ledger rows yet.
    Ledger,
}

#[derive(Clone, Debug)]
pub struct EnvVars {
    pub database_url: String,
    pub near_rpc_url: Option<String>,
    pub near_archival_rpc_url: Option<String>,
    pub bulk_payment_contract_id: AccountId,
    pub fastnear_api_key: String,
    pub sputnik_dao_api_base: String,
    pub bridge_rpc_url: String,
    pub ref_sdk_base_url: String,
    pub signer_key: SecretKey,
    pub signer_id: AccountId,
    pub bulk_payment_signer: SecretKey,
    pub disable_treasury_creation: bool,
    pub disable_stats_generation: bool,
    pub disable_ft_lockup_scheduler: bool,
    pub disable_gold_ledger_usd_backfill: bool,
    /// `BALANCE_READ_SOURCE`: "live" (default) or "ledger". Public
    /// treasuries only.
    pub balance_read_source: BalanceReadSource,
    /// `CONFIDENTIAL_BALANCE_READ_SOURCE`: "ledger" (default) or "live".
    /// "live" is the backup switch that fetches confidential balances
    /// directly from the 1Click API, bypassing the ledger.
    pub confidential_balance_read_source: BalanceReadSource,
    /// Track only treasuries created through this app: skips the sputnik
    /// factory mirror and makes user-initiated registrations refresh-only.
    pub managed_treasuries_only: bool,
    /// Allowed absolute drift (in NEAR) between the bronze-derived native
    /// ledger head and the on-chain balance before verification fails. Drift
    /// within tolerance is absorbed by a hidden reconciliation rebase.
    pub public_native_verification_tolerance_near: f64,
    pub telegram_bot_token: Option<String>,
    /// General notifications channel (user creation, treasury creation, etc.)
    pub telegram_chat_id: Option<String>,
    /// Dedicated ops / monitoring channel for status-monitor alerts.
    pub telegram_ops_chat_id: Option<String>,
    pub coingecko_api_key: Option<String>,
    pub coingecko_api_base_url: String, // Override for testing
    pub defillama_api_base_url: String, // DeFiLlama API base URL (override for testing)
    pub nearblocks_api_key: Option<String>,
    // Transfer hints configuration (FastNear transfers-api)
    // 1click API configuration for asset exchange quotes
    pub oneclick_api_url: String,
    // Confidential intents API URL (defaults to 1click-test)
    pub confidential_api_url: String,
    pub oneclick_jwt_token: Option<String>,
    pub oneclick_app_fee_bps: Option<u32>,
    pub oneclick_app_fee_recipient: Option<String>,
    pub oneclick_referral: Option<String>,
    pub oneclick_api_key: Option<String>,
    // Public status feeds used by user-facing banners and Oh Dear checks
    pub near_status_page_json_url: String,
    pub near_intents_status_api_url: String,
    // JWT authentication configuration
    pub jwt_secret: String,
    pub jwt_expiry_hours: u64,
    // CORS configuration
    pub cors_allowed_origins: Vec<String>,
    // Intents Explorer API configuration
    pub intents_explorer_api_key: Option<String>,
    pub intents_explorer_api_url: String,
    // Goldsky enrichment: Postgres (read-only Goldsky sink)
    pub goldsky_database_url: Option<String>,
    // Feature flags
    // Telegram bot webhook configuration
    pub telegram_webhook_secret: Option<String>,
    // Static API key guarding the internal analytics export endpoint
    pub analytics_api_key: Option<String>,
    // Basic-auth credentials for browser access to the analytics export endpoint
    pub analytics_users: Vec<crate::utils::admin_auth::AdminCredential>,
    pub frontend_base_url: String,
    pub admin_users: Vec<crate::utils::admin_auth::AdminCredential>,
    // Confidential auth token lifetime in days (default: 36500 ≈ 100 years)
    pub confidential_auth_expires_days: i64,
    pub testing_sputnik_dao_ids: HashSet<String>,
    pub testing_near_account_ids: HashSet<String>,
    /// Fine-scoped GitHub token with read access to the private
    /// `defuse-frontend-monorepos` repo (near.com catalog watch).
    pub nearcom_catalog_github_token: Option<String>,
}

fn parse_csv_set(key: &str) -> HashSet<String> {
    std::env::var(key)
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

impl Default for EnvVars {
    fn default() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL is not set"),
            near_rpc_url: std::env::var("NEAR_RPC_URL").ok().filter(|s| !s.is_empty()),
            near_archival_rpc_url: std::env::var("NEAR_ARCHIVAL_RPC_URL")
                .ok()
                .filter(|s| !s.is_empty()),
            bulk_payment_contract_id: std::env::var("BULK_PAYMENT_CONTRACT_ID")
                .unwrap_or_else(|_| "bulkpayment.near".to_string())
                .parse()
                .expect("Invalid BULK_PAYMENT_CONTRACT_ID"),
            bulk_payment_signer: std::env::var("BULK_PAYMENT_SIGNER")
                .expect("BULK_PAYMENT_SIGNER is not set")
                .parse()
                .expect("Invalid BULK_PAYMENT_SIGNER"),
            fastnear_api_key: std::env::var("FASTNEAR_API_KEY")
                .expect("FASTNEAR_API_KEY is not set"),
            sputnik_dao_api_base: std::env::var("SPUTNIK_DAO_API_BASE")
                .unwrap_or_else(|_| "https://sputnik-indexer.fly.dev".to_string()),
            bridge_rpc_url: std::env::var("BRIDGE_RPC_URL")
                .unwrap_or_else(|_| "https://bridge.chaindefuser.com/rpc".to_string()),
            ref_sdk_base_url: std::env::var("REF_SDK_BASE_URL").unwrap_or_else(|_| {
                "https://ref-sdk-test-cold-haze-1300-2.fly.dev/api".to_string()
            }),
            signer_key: std::env::var("SIGNER_KEY")
                .expect("SIGNER_KEY is not set")
                .parse()
                .unwrap(),
            signer_id: std::env::var("SIGNER_ID")
                .expect("SIGNER_ID is not set")
                .parse()
                .unwrap(),
            disable_treasury_creation: std::env::var("DISABLE_TREASURY_CREATION")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
            disable_stats_generation: std::env::var("DISABLE_STATS_GENERATION")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
            disable_ft_lockup_scheduler: std::env::var("DISABLE_FT_LOCKUP_SCHEDULER")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
            managed_treasuries_only: std::env::var("MANAGED_TREASURIES_ONLY")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
            disable_gold_ledger_usd_backfill: std::env::var("DISABLE_GOLD_LEDGER_USD_BACKFILL")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
            balance_read_source: match std::env::var("BALANCE_READ_SOURCE") {
                Ok(value) if value.eq_ignore_ascii_case("ledger") => BalanceReadSource::Ledger,
                _ => BalanceReadSource::Live,
            },
            confidential_balance_read_source: match std::env::var(
                "CONFIDENTIAL_BALANCE_READ_SOURCE",
            ) {
                Ok(value) if value.eq_ignore_ascii_case("live") => BalanceReadSource::Live,
                _ => BalanceReadSource::Ledger,
            },
            public_native_verification_tolerance_near: std::env::var(
                "PUBLIC_NATIVE_VERIFICATION_TOLERANCE_NEAR",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0.1),
            coingecko_api_key: std::env::var("COINGECKO_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            coingecko_api_base_url: std::env::var("COINGECKO_API_BASE_URL")
                .unwrap_or_else(|_| "https://pro-api.coingecko.com/api/v3".to_string()),
            defillama_api_base_url: std::env::var("DEFILLAMA_API_BASE_URL")
                .unwrap_or_else(|_| "https://coins.llama.fi".to_string()),
            telegram_bot_token: std::env::var("TELEGRAM_BOT_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            telegram_chat_id: std::env::var("TELEGRAM_CHAT_ID")
                .ok()
                .filter(|s| !s.is_empty()),
            telegram_ops_chat_id: std::env::var("TELEGRAM_OPS_CHAT_ID")
                .ok()
                .filter(|s| !s.is_empty()),
            nearblocks_api_key: std::env::var("NEARBLOCKS_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            // 1click API configuration
            oneclick_api_url: std::env::var("ONECLICK_API_URL")
                .unwrap_or_else(|_| "https://1click.chaindefuser.com".to_string()),
            confidential_api_url: std::env::var("CONFIDENTIAL_API_URL")
                .unwrap_or_else(|_| "https://1click-test.chaindefuser.com".to_string()),
            oneclick_jwt_token: std::env::var("ONECLICK_JWT_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            oneclick_app_fee_bps: std::env::var("ONECLICK_APP_FEE_BPS")
                .ok()
                .and_then(|s| s.parse().ok())
                .or(Some(35)), // Default: 0.35%
            oneclick_app_fee_recipient: std::env::var("ONECLICK_APP_FEE_RECIPIENT")
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| Some("trezu.sputnik-dao.near".to_string())),
            oneclick_referral: std::env::var("ONECLICK_REFERRAL")
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| Some("trezu".to_string())),
            oneclick_api_key: std::env::var("ONECLICK_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            near_status_page_json_url: std::env::var("NEAR_STATUS_PAGE_JSON_URL")
                .unwrap_or_else(|_| "https://status.near.org/json".to_string()),
            near_intents_status_api_url: std::env::var("NEAR_INTENTS_STATUS_API_URL")
                .unwrap_or_else(|_| {
                    "https://status.near-intents.org/api/posts?is_featured=true".to_string()
                }),
            // JWT configuration
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET is not set"),
            jwt_expiry_hours: std::env::var("JWT_EXPIRY_HOURS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(72), // Default: 72 hours
            // CORS configuration
            cors_allowed_origins: std::env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:3001,http://localhost:3000".to_string())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            // Intents Explorer API configuration
            intents_explorer_api_key: std::env::var("INTENTS_EXPLORER_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            intents_explorer_api_url: std::env::var("INTENTS_EXPLORER_API_URL")
                .unwrap_or_else(|_| "https://explorer.near-intents.org/api/v0".to_string()),
            goldsky_database_url: std::env::var("GOLDSKY_DATABASE_URL")
                .ok()
                .filter(|s| !s.is_empty()),
            telegram_webhook_secret: std::env::var("TELEGRAM_WEBHOOK_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),
            analytics_api_key: std::env::var("ANALYTICS_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            analytics_users: crate::utils::admin_auth::parse_admin_users(
                std::env::var("ANALYTICS_USERS").ok().as_deref(),
            ),
            frontend_base_url: std::env::var("FRONTEND_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3001".to_string()),
            admin_users: crate::utils::admin_auth::parse_admin_users(
                std::env::var("ADMIN_USERS").ok().as_deref(),
            ),
            confidential_auth_expires_days: std::env::var("CONFIDENTIAL_AUTH_EXPIRES_DAYS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(36500), // Default: ~100 years
            testing_sputnik_dao_ids: parse_csv_set("TESTING_SPUTNIK_DAO_IDS"),
            testing_near_account_ids: parse_csv_set("TESTING_NEAR_ACCOUNT_IDS"),
            nearcom_catalog_github_token: std::env::var("NEARCOM_CATALOG_GITHUB_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
        }
    }
}
