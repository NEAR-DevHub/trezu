use axum::{Json, extract::State, http::StatusCode};
use bigdecimal::BigDecimal;
use borsh::BorshDeserialize;
use near_api::{
    AccountId, Contract, NearToken, Tokens, Transaction,
    types::{
        Action,
        json::{Base64VecU8, U128},
        tokens::STORAGE_COST_PER_BYTE,
        transaction::delegate_action::SignedDelegateAction,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, ops::Deref, sync::Arc};

use crate::{
    AppState,
    auth::AuthUser,
    config::plans::{PlanType, has_gas_covered_credits},
    handlers::{
        intents::supported_tokens::fetch_supported_tokens_data,
        user::assets::fetch_whitelisted_tokens,
    },
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRequest {
    pub treasury_id: AccountId,
    pub storage_bytes: U128,
    /// Base64-encoded borsh-serialized SignedDelegateAction
    pub signed_delegate_action: Base64VecU8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn error_response(status: StatusCode, msg: String) -> (StatusCode, Json<RelayResponse>) {
    (
        status,
        Json(RelayResponse {
            success: false,
            error: Some(msg),
        }),
    )
}

const MAX_STORAGE_BYTES: u128 = 4000;
const MAX_SPONSORING: NearToken = NearToken::from_millinear(1200);
// We need to multiply the buffer by 25 because this is the bulk payment limit for single transaction
// This is worse case scenario where all bulk payments recipients are not registered in the token contract
const TOKEN_STORAGE_BUFFER: NearToken = NearToken::from_micronear(1250).saturating_mul(25);
const SPUTNIK_DAO_SUFFIX: &str = ".sputnik-dao.near";

fn extract_intents_contract(asset_id: &str) -> Option<&str> {
    asset_id.strip_prefix("nep141:").or_else(|| asset_id.strip_prefix("nep245:").and_then(|s| s.split(":").nth(0)))
}

fn extract_intents_whitelist_contracts(supported_tokens: &Value) -> HashSet<String> {
    let mut contracts = HashSet::new();
    let Some(tokens) = supported_tokens.get("tokens").and_then(Value::as_array) else {
        return contracts;
    };

    for token in tokens {
        let is_nep141 = token
            .get("standard")
            .and_then(Value::as_str)
            .map(|standard| standard == "nep141")
            .unwrap_or(false);
        if !is_nep141 {
            continue;
        }

        for field in ["intents_token_id", "defuse_asset_identifier"] {
            if let Some(asset_id) = token.get(field).and_then(Value::as_str)
                && let Some(contract_id) = extract_intents_contract(asset_id)
            {
                contracts.insert(contract_id.to_string());
            }
        }
    }

    contracts
}

async fn fetch_allowed_receiver_contracts(
    state: &Arc<AppState>,
    treasury_id: &AccountId,
) -> Result<HashSet<String>, (StatusCode, Json<RelayResponse>)> {
    let mut allowed_contracts = HashSet::new();
    allowed_contracts.insert(treasury_id.to_string());

    let supported_tokens = fetch_supported_tokens_data(state)
        .await
        .map_err(|(_, msg)| {
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch intents whitelist: {}", msg),
            )
        })?;
    allowed_contracts.extend(extract_intents_whitelist_contracts(&supported_tokens));

    let ref_whitelist = fetch_whitelisted_tokens(state).await.map_err(|(_, msg)| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch ref whitelist: {}", msg),
        )
    })?;
    allowed_contracts.extend(ref_whitelist);

    Ok(allowed_contracts)
}

async fn fetch_treasury_deposit_bond(
    state: &Arc<AppState>,
    treasury_id: &AccountId,
) -> Result<NearToken, (StatusCode, Json<RelayResponse>)> {
    let policy = Contract(treasury_id.clone())
        .call_function("get_policy", ())
        .read_only::<serde_json::Value>()
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch DAO policy: {}", e),
            )
        })?
        .data;

    let deposit_bond_raw = policy
        .get("proposal_bond")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DAO policy is missing proposal_bond".to_string(),
            )
        })?;

    let deposit_bond_yocto = deposit_bond_raw.parse::<u128>().map_err(|e| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Invalid proposal_bond in DAO policy: {}", e),
        )
    })?;

    Ok(NearToken::from_yoctonear(deposit_bond_yocto))
}

/// Relay a signed delegate action (NEP-366 meta-transaction) to the NEAR network.
///
/// The backend wraps the user's signed delegate action in a regular transaction,
/// signs it with the relayer key (paying for gas), and submits to the network.
/// On success, decrements the treasury's gas-covered transaction credits.
pub async fn relay_delegate_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(request): Json<RelayRequest>,
) -> Result<Json<RelayResponse>, (StatusCode, Json<RelayResponse>)> {
    auth_user
        .verify_dao_member(&state.db_pool, request.treasury_id.as_str())
        .await
        .map_err(|e| {
            error_response(
                StatusCode::FORBIDDEN,
                format!("Not a DAO policy member: {}", e),
            )
        })?;

    // Step 1: Decode and deserialize SignedDelegateAction
    let signed_delegate_action =
        SignedDelegateAction::try_from_slice(&request.signed_delegate_action.0).map_err(|e| {
            error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid delegate action: {}", e),
            )
        })?;

    // Step 2: Verify sender_id matches authenticated user
    let sender_id = signed_delegate_action.delegate_action.sender_id.to_string();
    if sender_id != auth_user.account_id {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            format!(
                "Delegate action sender '{}' does not match authenticated user '{}'",
                sender_id, auth_user.account_id
            ),
        ));
    }

    // Step 3: Check gas-covered transaction credits
    let credits_result = sqlx::query_as::<_, (i32, PlanType)>(
        r#"
        SELECT gas_covered_transactions, plan_type
        FROM monitored_accounts
        WHERE account_id = $1
        "#,
    )
    .bind(request.treasury_id.as_str())
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;

    match credits_result {
        None => {
            return Err(error_response(
                StatusCode::NOT_FOUND,
                format!(
                    "Treasury '{}' not found in monitored accounts",
                    request.treasury_id.as_str()
                ),
            ));
        }
        Some((current_credits, plan_type)) => {
            if !has_gas_covered_credits(plan_type, current_credits) {
                return Err(error_response(
                    StatusCode::PAYMENT_REQUIRED,
                    "No gas-covered transaction credits remaining. Please upgrade your plan."
                        .to_string(),
                ));
            }
        }
    }

    // Step 4: Validate allowed receiver contract and sponsorship limits
    // Per NEP-366, the relayer sends a transaction to the delegate action's sender_id.
    let receiver_id = signed_delegate_action.delegate_action.sender_id.clone();
    let action_receiver_id = signed_delegate_action.delegate_action.receiver_id.clone();

    let allowed_contracts = fetch_allowed_receiver_contracts(&state, &request.treasury_id).await?;
    if !allowed_contracts.contains(action_receiver_id.as_str()) {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            format!(
                "Contract '{}' is not allowed for relayed actions",
                action_receiver_id
            ),
        ));
    }

    let should_balance_storage = action_receiver_id.as_str().ends_with(SPUTNIK_DAO_SUFFIX);

    let storage_cost = STORAGE_COST_PER_BYTE.saturating_mul(request.storage_bytes.0);
    let deposits = signed_delegate_action
        .delegate_action
        .actions
        .iter()
        .map(Deref::deref)
        .fold(NearToken::from_millinear(0), |acc, action| {
            if let Action::FunctionCall(action) = action {
                acc.saturating_add(action.deposit)
            } else {
                acc
            }
        });

    let deposit_bond = fetch_treasury_deposit_bond(&state, &request.treasury_id).await?;
    let max_deposit = deposit_bond.saturating_add(TOKEN_STORAGE_BUFFER);
    let (paid, limit) = if should_balance_storage {
        (
            deposits.saturating_add(storage_cost),
            max_deposit.saturating_add(storage_cost).min(MAX_SPONSORING),
        )
    } else {
        (deposits, max_deposit.min(MAX_SPONSORING))
    };

    if paid > limit {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            format!(
                "Total deposit exceeds sponsorship limit of {} millinear",
                limit.as_millinear()
            ),
        ));
    }

    // Step 5: For Sputnik DAOs only, top up near balance for storage before executing delegate action.
    if should_balance_storage {
        if request.storage_bytes.0 > MAX_STORAGE_BYTES {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                format!(
                    "Storage bytes must be less than {} bytes",
                    MAX_STORAGE_BYTES
                ),
            ));
        }

        Tokens::account(state.signer_id.clone())
            .send_to(request.treasury_id.clone())
            .near(storage_cost)
            .with_signer(state.signer.clone())
            .send_to(&state.network)
            .await
            .map_err(|e| {
                error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to send storage top-up transaction: {}", e),
                )
            })?
            .into_result()
            .map_err(|e| {
                error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to send storage top-up transaction: {}", e),
                )
            })?;
    }

    // Step 6: Submit the wrapped delegate action transaction.
    let execution_result = Transaction::construct(state.signer_id.clone(), receiver_id)
        .add_action(Action::Delegate(Box::new(signed_delegate_action)))
        .with_signer(state.signer.clone())
        .send_to(&state.network)
        .await;

    match execution_result {
        Ok(result) => match result.into_result() {
            Ok(_) => {
                // Step 7: Decrement gas-covered credits and accumulate paid_near in one query
                let near_spent = if should_balance_storage {
                    storage_cost.saturating_add(deposits)
                } else {
                    deposits
                };
                let near_spent_yocto: BigDecimal = near_spent.as_yoctonear().into();
                let db_result = sqlx::query_as::<_, (i32,)>(
                    r#"
                    UPDATE monitored_accounts
                    SET gas_covered_transactions = GREATEST(gas_covered_transactions - 1, 0),
                        paid_near = paid_near + $2,
                        updated_at = NOW()
                    WHERE account_id = $1
                    RETURNING gas_covered_transactions
                    "#,
                )
                .bind(request.treasury_id.as_str())
                .bind(near_spent_yocto)
                .fetch_optional(&state.db_pool)
                .await;

                match db_result {
                    Ok(Some((new_credits,))) => {
                        log::info!(
                            "Decremented gas credits for treasury {}. New balance: {}",
                            request.treasury_id.as_str(),
                            new_credits
                        );
                    }
                    Ok(None) => {
                        log::warn!(
                            "Treasury {} not found for credit decrement",
                            request.treasury_id.as_str()
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to decrement gas credits for {}: {}",
                            request.treasury_id.as_str(),
                            e
                        );
                        // Don't fail - the relay already succeeded
                    }
                }

                Ok(Json(RelayResponse {
                    success: true,
                    error: None,
                }))
            }
            Err(e) => {
                log::error!("Delegate action execution failed: {:?}", e);
                Err(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Execution failed: {}", e),
                ))
            }
        },
        Err(e) => {
            log::error!("Failed to relay delegate action: {:?}", e);
            Err(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to relay: {}", e),
            ))
        }
    }
}
