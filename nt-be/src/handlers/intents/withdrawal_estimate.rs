use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;
use crate::utils::jsonrpc::{JsonRpcRequest, JsonRpcResponse};

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct WithdrawalEstimateRequest {
    pub token: String,
    pub address: String,
    pub chain: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWithdrawalEstimateResult {
    pub withdrawal_fee: String,
    pub withdrawal_fee_decimals: u8,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawalFeeResponse {
    pub withdrawal_fee: String,
    pub withdrawal_fee_decimals: u8,
}

pub async fn get_withdrawal_fee(
    State(state): State<Arc<AppState>>,
    Json(request): Json<WithdrawalEstimateRequest>,
) -> Result<Json<WithdrawalFeeResponse>, (StatusCode, String)> {
    if request.token.trim().is_empty()
        || request.address.trim().is_empty()
        || request.chain.trim().is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "token, address and chain are required".to_string(),
        ));
    }

    let rpc_request =
        JsonRpcRequest::new("withdrawalEstimate", "withdrawal_estimate", vec![request]);

    let response = state
        .http_client
        .post(&state.env_vars.bridge_rpc_url)
        .header("content-type", "application/json")
        .json(&rpc_request)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to fetch withdrawal estimate: {}", e),
            )
        })?;

    if !response.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("Bridge RPC returned HTTP status {}", response.status()),
        ));
    }

    let data = response
        .json::<JsonRpcResponse<BridgeWithdrawalEstimateResult>>()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to parse withdrawal estimate response: {}", e),
            )
        })?;

    if let Some(error) = data.error {
        return Err((
            StatusCode::BAD_GATEWAY,
            error
                .data
                .and_then(|v| v.as_str().map(ToString::to_string))
                .unwrap_or(error.message),
        ));
    }

    let result = data.result.ok_or_else(|| {
        (
            StatusCode::BAD_GATEWAY,
            "No withdrawal estimate returned".to_string(),
        )
    })?;

    Ok(Json(WithdrawalFeeResponse {
        withdrawal_fee: result.withdrawal_fee,
        withdrawal_fee_decimals: result.withdrawal_fee_decimals,
    }))
}
