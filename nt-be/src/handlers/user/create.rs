use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use near_account_id::AccountType;
use near_api::{Account, AccountId, NearToken, PublicKey, Tokens};
use serde::{Deserialize, Serialize};

use crate::AppState;

pub const USER_CREATE_DEPOSIT: NearToken = NearToken::from_micronear(1820);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub account_id: AccountId,
    pub public_key: PublicKey,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserResponse {
    pub account_id: AccountId,
    pub created: bool,
}

pub async fn create_user_account(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<CreateUserResponse>, (StatusCode, String)> {
    let account_id = payload.account_id.clone();
    let public_key = payload.public_key;

    // Only allow creation for accounts that do not exist yet.
    match Account(account_id.clone())
        .view()
        .fetch_from(&state.network)
        .await
    {
        Ok(_) => {
            return Err((
                StatusCode::CONFLICT,
                format!("Account {} already exists", account_id),
            ));
        }
        Err(e) => {
            if !e.to_string().contains("UnknownAccount") {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to check account existence: {}", e),
                ));
            }
        }
    }

    match account_id.get_account_type() {
        AccountType::NamedAccount => {
            Account::create_account(account_id.clone())
                .fund_myself(state.signer_id.clone(), USER_CREATE_DEPOSIT)
                .with_public_key(public_key)
                .with_signer(state.signer.clone())
                .send_to(&state.network)
                .await
                .map_err(|e| {
                    eprintln!("Error creating user account {}: {}", account_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?
                .into_result()
                .map_err(|e| {
                    eprintln!("Error creating user account {}: {}", account_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
        }
        AccountType::NearImplicitAccount => {
            Tokens::account(state.signer_id.clone())
                .send_to(account_id.clone())
                .near(USER_CREATE_DEPOSIT)
                .with_signer(state.signer.clone())
                .send_to(&state.network)
                .await
                .map_err(|e| {
                    eprintln!(
                        "Error sending near to implicit account {}: {}",
                        account_id, e
                    );
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?
                .into_result()
                .map_err(|e| {
                    eprintln!(
                        "Error sending near to implicit account {}: {}",
                        account_id, e
                    );
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!(
                    "Unsupported account type: {:?}",
                    account_id.get_account_type()
                ),
            ));
        }
    }

    let details = format!("Ledger user account created: {account_id}",);
    if let Err(e) = state.telegram_client.send_message(&details).await {
        log::warn!("Failed to send Telegram notification: {}", e);
    }

    Ok(Json(CreateUserResponse {
        account_id,
        created: true,
    }))
}
