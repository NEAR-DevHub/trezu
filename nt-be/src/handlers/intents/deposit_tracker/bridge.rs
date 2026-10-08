//! Bridge (PoA) `recent_deposits` client for public treasuries.
//!
//! Response shape (observed live, superset of `@defuse-protocol/internal-utils`):
//! `{ deposits: [{ tx_hash, mint_tx_hash, chain, defuse_asset_identifier,
//! near_token_id, decimals, amount, account_id, address, status, created_at,
//! from }] }` with status one of `COMPLETED | PENDING | FAILED`.
//! `defuse_asset_identifier` is the chain-scoped id (`eth:8453:0x…`), not the
//! NEP-141 id; `near_token_id` is the omft contract the mint credits.
//! `mint_tx_hash` is the NEAR mint transaction, the same hash the ledger row
//! carries. There is no deposit id or pagination; `amount` is a JSON number.

use std::sync::LazyLock;

use bigdecimal::BigDecimal;
use serde::Deserialize;
use serde_json::Value;

use crate::AppState;
use crate::utils::jsonrpc::JsonRpcRequest;
use crate::utils::rate_limiter::RateLimiter;

use super::DepositStatus;
use super::store::ObservedDeposit;

const BRIDGE_MAX_PER_SECOND: u32 = 5;
const BRIDGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

static BRIDGE_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::per_second("bridge-recent-deposits", BRIDGE_MAX_PER_SECOND));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeDepositStatus {
    Pending,
    Completed,
    Failed,
}

impl BridgeDepositStatus {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_uppercase().as_str() {
            "PENDING" => Some(Self::Pending),
            "COMPLETED" => Some(Self::Completed),
            "FAILED" => Some(Self::Failed),
            _ => None,
        }
    }

    pub fn tracker_status(self) -> DepositStatus {
        match self {
            Self::Pending => DepositStatus::Detected,
            Self::Completed => DepositStatus::Finalized,
            Self::Failed => DepositStatus::Failed,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct RawBridgeDeposit {
    tx_hash: String,
    mint_tx_hash: Option<String>,
    chain: String,
    defuse_asset_identifier: String,
    near_token_id: Option<String>,
    decimals: Option<i64>,
    /// Kept as raw JSON so integer amounts are not forced through f64.
    amount: Option<Value>,
    status: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RecentDepositsResult {
    #[serde(default)]
    deposits: Vec<RawBridgeDeposit>,
}

/// One bridge deposit, normalised to tracker vocabulary.
#[derive(Debug, Clone)]
pub struct BridgeDeposit {
    pub key: String,
    pub chain: String,
    pub origin_tx_hash: String,
    pub near_tx_hash: Option<String>,
    pub defuse_asset_id: String,
    pub near_token_id: Option<String>,
    pub amount: Option<BigDecimal>,
    pub provider_status: String,
    pub status: BridgeDepositStatus,
}

impl BridgeDeposit {
    fn from_raw(raw: RawBridgeDeposit) -> Option<Self> {
        let status = BridgeDepositStatus::parse(&raw.status)?;
        let amount = raw
            .amount
            .as_ref()
            .and_then(decimal_from_json_number)
            .map(|base_units| scale_down(base_units, raw.decimals.unwrap_or(0)));
        Some(Self {
            key: format!(
                "{}:{}:{}",
                raw.chain, raw.tx_hash, raw.defuse_asset_identifier
            ),
            chain: raw.chain,
            origin_tx_hash: raw.tx_hash,
            near_tx_hash: raw.mint_tx_hash.filter(|hash| !hash.trim().is_empty()),
            defuse_asset_id: raw.defuse_asset_identifier,
            near_token_id: raw.near_token_id.filter(|id| !id.trim().is_empty()),
            amount,
            provider_status: raw.status,
            status,
        })
    }

    /// Ledger token id the gold mint row will carry
    /// (`intents.near:nep141:<contract>` or `intents.near:nep245:<contract>:<token>`).
    /// NEAR account ids never contain `:`, so a colon in `near_token_id` means
    /// a multi-token (HOT bridge `v2_1.omni.hot.tg:<chain>_<token>`). Falls back
    /// to the chain-scoped defuse id when the bridge omits the NEAR contract.
    pub fn ledger_token_id(&self) -> String {
        match self.near_token_id.as_deref() {
            Some(token) if token.contains(':') => format!("intents.near:nep245:{token}"),
            Some(contract) => format!("intents.near:nep141:{contract}"),
            None => format!("intents.near:{}", self.defuse_asset_id),
        }
    }

    pub fn observed(&self) -> ObservedDeposit {
        ObservedDeposit {
            provider_deposit_key: self.key.clone(),
            chain: Some(self.chain.clone()),
            origin_tx_hash: Some(self.origin_tx_hash.clone()),
            near_tx_hash: self.near_tx_hash.clone(),
            token_id: self.ledger_token_id(),
            amount: self.amount.clone(),
            provider_status: self.provider_status.clone(),
            status: self.status.tracker_status(),
        }
    }
}

fn decimal_from_json_number(value: &Value) -> Option<BigDecimal> {
    match value {
        Value::Number(number) => number.to_string().parse().ok(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

fn scale_down(base_units: BigDecimal, decimals: i64) -> BigDecimal {
    let (digits, scale) = base_units.into_bigint_and_exponent();
    BigDecimal::new(digits, scale + decimals)
}

pub struct BridgeDepositsClient<'a> {
    state: &'a AppState,
}

impl<'a> BridgeDepositsClient<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    /// All recent deposits the bridge knows for `account_id`, every chain.
    pub async fn recent_deposits(&self, account_id: &str) -> Result<Vec<BridgeDeposit>, String> {
        BRIDGE_LIMITER.acquire().await;

        let request = JsonRpcRequest::new(
            "recentDepositsFetch",
            "recent_deposits",
            vec![serde_json::json!({ "account_id": account_id })],
        );
        let response = self
            .state
            .http_client
            .post(&self.state.env_vars.bridge_rpc_url)
            .timeout(BRIDGE_TIMEOUT)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("bridge recent_deposits request failed: {}", error_chain(&e)))?;

        if !response.status().is_success() {
            return Err(format!("bridge recent_deposits HTTP {}", response.status()));
        }

        let raw: Value = response
            .json()
            .await
            .map_err(|e| format!("bridge recent_deposits body is not JSON: {e}"))?;
        parse_recent_deposits(&raw)
    }
}

/// reqwest's `Display` stops at "error sending request"; the cause (DNS,
/// TLS, reset, timeout) sits in the source chain.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

fn parse_recent_deposits(raw: &Value) -> Result<Vec<BridgeDeposit>, String> {
    if let Some(error) = raw.get("error") {
        let message = error
            .as_str()
            .map(str::to_string)
            .or_else(|| {
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| error.to_string());
        return Err(format!("bridge recent_deposits error: {message}"));
    }
    let result = raw
        .get("result")
        .ok_or_else(|| "bridge recent_deposits response missing result".to_string())?;
    let parsed: RecentDepositsResult = serde_json::from_value(result.clone())
        .map_err(|e| format!("bridge recent_deposits result parse failed: {e}"))?;
    Ok(parsed
        .deposits
        .into_iter()
        .filter_map(BridgeDeposit::from_raw)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn parses_deposits_and_scales_amount_by_decimals() {
        let raw = serde_json::json!({
            "jsonrpc": "2.0",
            "id": "recentDepositsFetch",
            "result": { "deposits": [{
                "tx_hash": "0xabc",
                "mint_tx_hash": "EvrG97Bqj3jhFWXNpfy1hyvVyabAqnFABJhZmzHGbuDG",
                "chain": "eth:8453",
                "defuse_asset_identifier": "eth:8453:0x8335",
                "near_token_id": "base-0x8335.omft.near",
                "decimals": 6,
                "amount": 100000000,
                "account_id": "dao.sputnik-dao.near",
                "address": "0xdeposit",
                "status": "COMPLETED"
            }, {
                "tx_hash": "0xdef",
                "chain": "eth:8453",
                "defuse_asset_identifier": "eth:8453:0x8335",
                "near_token_id": "base-0x8335.omft.near",
                "decimals": 6,
                "amount": 5000000,
                "account_id": "dao.sputnik-dao.near",
                "address": "0xdeposit",
                "status": "SOMETHING_NEW"
            }]}
        });
        let deposits = parse_recent_deposits(&raw).expect("parses");
        assert_eq!(deposits.len(), 1, "unknown statuses are dropped");
        let deposit = &deposits[0];
        assert_eq!(deposit.key, "eth:8453:0xabc:eth:8453:0x8335");
        assert_eq!(
            deposit.ledger_token_id(),
            "intents.near:nep141:base-0x8335.omft.near"
        );
        assert_eq!(
            deposit.near_tx_hash.as_deref(),
            Some("EvrG97Bqj3jhFWXNpfy1hyvVyabAqnFABJhZmzHGbuDG")
        );
        assert_eq!(deposit.observed().token_id, deposit.ledger_token_id());
        assert_eq!(deposit.amount, Some(BigDecimal::from_str("100").unwrap()));
        assert_eq!(deposit.status, BridgeDepositStatus::Completed);
        assert_eq!(deposit.status.tracker_status(), DepositStatus::Finalized);
    }

    #[test]
    fn hot_bridge_multi_token_maps_to_nep245() {
        let raw = serde_json::json!({
            "result": { "deposits": [{
                "tx_hash": "0x5397",
                "mint_tx_hash": "4gfMyBb8iaRmB7cErbJDbGeUhDtxiDsSsCZkctrycWG2",
                "chain": "eth:56",
                "defuse_asset_identifier": "eth:56:0x55d398326f99059ff775485246999027b3197955",
                "near_token_id": "v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g",
                "decimals": 18,
                "amount": 200000000000000000u64,
                "status": "COMPLETED"
            }, {
                "tx_hash": "3EUrSr",
                "mint_tx_hash": "",
                "chain": "sol:mainnet",
                "defuse_asset_identifier": "sol:mainnet:USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
                "near_token_id": "sol-0x936420c6ae310eb29511d139991654f922456fbe.omdep.near",
                "decimals": 6,
                "amount": 200000,
                "status": "COMPLETED"
            }]}
        });
        let deposits = parse_recent_deposits(&raw).expect("parses");
        assert_eq!(
            deposits[0].ledger_token_id(),
            "intents.near:nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g"
        );
        assert_eq!(
            deposits[1].ledger_token_id(),
            "intents.near:nep141:sol-0x936420c6ae310eb29511d139991654f922456fbe.omdep.near"
        );
        assert_eq!(deposits[1].near_tx_hash, None, "empty mint hash is None");
    }

    #[test]
    fn string_error_is_surfaced() {
        let raw = serde_json::json!({ "error": "Account not found" });
        let error = parse_recent_deposits(&raw).unwrap_err();
        assert!(error.contains("Account not found"));
    }

    #[test]
    fn integer_and_string_amounts_are_exact() {
        let from_number =
            decimal_from_json_number(&serde_json::json!(18_446_744_073_709_551_615u64))
                .expect("u64 parses");
        assert_eq!(
            from_number,
            BigDecimal::from_str("18446744073709551615").unwrap()
        );
        let from_string = decimal_from_json_number(&serde_json::json!("1000000000000000000000"))
            .expect("string parses");
        assert_eq!(
            scale_down(from_string, 18),
            BigDecimal::from_str("1000").unwrap()
        );
    }
}
