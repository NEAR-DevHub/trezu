use std::sync::Arc;

use axum::{Json, extract::State};
use base64::{Engine, prelude::BASE64_STANDARD};
use bigdecimal::BigDecimal;
use near_api::{AccountId, Contract, NearToken, Tokens};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    constants::TREASURY_FACTORY_CONTRACT_ID,
    services::{register_new_dao, register_or_refresh_monitored_account},
};

use super::confidential_setup;

pub const TREASURY_CREATE_DEPOSIT: NearToken = NearToken::from_millinear(90);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTreasuryRequest {
    pub name: String,
    pub account_id: AccountId,
    pub payment_threshold: u8,
    pub governance_threshold: u8,
    pub governors: Vec<AccountId>,
    pub financiers: Vec<AccountId>,
    pub requestors: Vec<AccountId>,
    #[serde(default)]
    pub is_confidential: bool,
}

#[derive(Serialize, Deserialize)]
pub struct CreateTreasuryResponse {
    pub treasury: AccountId,
}

/// Build the sputnik-dao policy JSON for the given members and thresholds.
pub fn build_policy(
    requestors: &[AccountId],
    governors: &[AccountId],
    financiers: &[AccountId],
    governance_threshold: u8,
    payment_threshold: u8,
) -> serde_json::Value {
    let one_required_vote = serde_json::json!({
      "weight_kind": "RoleWeight",
      "quorum": "0",
      "threshold": "1",
    });

    let governance_threshold_json = serde_json::json!({
      "weight_kind": "RoleWeight",
      "quorum": "0",
      "threshold": governance_threshold.to_string(),
    });

    let payment_threshold_json = serde_json::json!({
      "weight_kind": "RoleWeight",
      "quorum": "0",
      "threshold": payment_threshold.to_string(),
    });

    serde_json::json!({
      "roles": [
        {
          "kind": {
            "Group": requestors,
          },
          "name": "Requestor",
          "permissions": [
            "call:AddProposal",
            "transfer:AddProposal",
            "call:VoteRemove",
            "transfer:VoteRemove"
          ],
          "vote_policy": {
            "transfer": one_required_vote.clone(),
            "call": one_required_vote.clone()
          }
        },
        {
          "kind": {
            "Group": governors,
          },
          "name": "Admin",
          "permissions": [
            "config:*",
            "policy:*",
            "add_member_to_role:*",
            "remove_member_from_role:*",
            "upgrade_self:*",
            "upgrade_remote:*",
            "set_vote_token:*",
            "add_bounty:*",
            "bounty_done:*",
            "factory_info_update:*",
            "policy_add_or_update_role:*",
            "policy_remove_role:*",
            "policy_update_default_vote_policy:*",
            "policy_update_parameters:*",
          ],
          "vote_policy": {
            "config": governance_threshold_json.clone(),
            "policy": governance_threshold_json.clone(),
            "add_member_to_role": governance_threshold_json.clone(),
            "remove_member_from_role": governance_threshold_json.clone(),
            "upgrade_self": governance_threshold_json.clone(),
            "upgrade_remote": governance_threshold_json.clone(),
            "set_vote_token": governance_threshold_json.clone(),
            "add_bounty": governance_threshold_json.clone(),
            "bounty_done": governance_threshold_json.clone(),
            "factory_info_update": governance_threshold_json.clone(),
            "policy_add_or_update_role": governance_threshold_json.clone(),
            "policy_remove_role": governance_threshold_json.clone(),
            "policy_update_default_vote_policy": governance_threshold_json.clone(),
            "policy_update_parameters": governance_threshold_json.clone(),
          },
        },
        {
          "kind": {
            "Group": financiers,
          },
          "name": "Approver",
          "permissions": [
            "call:VoteReject",
            "call:VoteApprove",
            "call:RemoveProposal",
            "call:Finalize",
            "transfer:VoteReject",
            "transfer:VoteApprove",
            "transfer:RemoveProposal",
            "transfer:Finalize",
          ],
          "vote_policy": {
            "transfer": payment_threshold_json.clone(),
            "call": payment_threshold_json.clone(),
          },
        },
      ],
      "default_vote_policy": {
        "weight_kind": "RoleWeight",
        "quorum": "0",
        "threshold": [1, 2],
      },
      "proposal_bond": NearToken::from_millinear(0),
      "proposal_period": "604800000000000",
      "bounty_bond": NearToken::from_millinear(0),
      "bounty_forgiveness_period": "604800000000000",
    })
}

fn prepare_args(
    payload: &CreateTreasuryRequest,
    policy: &serde_json::Value,
) -> Result<serde_json::Value, serde_json::Error> {
    let config = serde_json::json!({
      "config": {
        "name": payload.name,
        "purpose": "managing digital assets",
        "metadata": "",
      },
      "policy": policy,
    });

    let bytes = BASE64_STANDARD.encode(serde_json::to_vec(&config)?);

    let name = payload
        .account_id
        .as_str()
        .strip_suffix(".sputnik-dao.near")
        .unwrap_or(payload.account_id.as_str());
    Ok(serde_json::json!({
      "name": name,
      "args": bytes,
    }))
}

pub async fn create_treasury(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateTreasuryRequest>,
) -> Result<Json<CreateTreasuryResponse>, (StatusCode, String)> {
    let treasury = payload.account_id.clone();
    let is_confidential = payload.is_confidential;

    if state.env_vars.disable_treasury_creation {
        let message = format!("Treasury creation disabled. Treasury: {treasury} is not created.");
        if let Err(e) = state.telegram_client.send_message(&message).await {
            log::warn!("Failed to send Telegram notification: {}", e);
        }
        return Err((StatusCode::SERVICE_UNAVAILABLE, message));
    }

    // Build the user's desired policy (used for both normal and confidential flows)
    let user_policy = build_policy(
        &payload.requestors,
        &payload.governors,
        &payload.financiers,
        payload.governance_threshold,
        payload.payment_threshold,
    );

    // For confidential setup: create the DAO with the sponsor as the sole member
    // so we can submit and auto-approve the auth proposal before handing off to the user.
    let creation_policy = if is_confidential {
        let sponsor = vec![state.signer_id.clone()];
        build_policy(&sponsor, &sponsor, &sponsor, 1, 1)
    } else {
        user_policy.clone()
    };

    let args = prepare_args(&payload, &creation_policy).map_err(|e| {
        eprintln!("Error preparing args: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    Contract(TREASURY_FACTORY_CONTRACT_ID.into())
        .call_function("create", args)
        .transaction()
        .max_gas()
        .deposit(TREASURY_CREATE_DEPOSIT)
        .with_signer(state.signer_id.clone(), state.signer.clone())
        .send_to(&state.network)
        .await
        .map_err(|e| {
            eprintln!("Error creating treasury: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?
        .into_result()
        .map_err(|e| {
            eprintln!("Error creating treasury: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    if let Err(e) = register_or_refresh_monitored_account(&state.db_pool, treasury.as_str()).await {
        log::warn!("Failed to add treasury to monitored accounts: {:?}", e);
    }

    // Record NEAR spent on treasury creation and mark as created by our platform
    let creation_cost: BigDecimal = TREASURY_CREATE_DEPOSIT.as_yoctonear().into();
    if let Err(e) = sqlx::query!(
        r#"
        UPDATE monitored_accounts
        SET paid_near = paid_near + $2,
            created_by_trezu_at = NOW(),
            updated_at = NOW()
        WHERE account_id = $1
        "#,
        treasury.as_str(),
        creation_cost,
    )
    .execute(&state.db_pool)
    .await
    {
        log::warn!(
            "Failed to update paid_near for {}: {}",
            treasury.as_str(),
            e
        );
    }

    // ── Confidential setup ──────────────────────────────────────────────
    // Authenticate the DAO with 1Click, then change the policy to the
    // user's desired config (removing the sponsor).
    if is_confidential {
        confidential_setup::setup_confidential_treasury(&state, &treasury, user_policy).await?;
    }

    // Register new DAO in local cache for immediate visibility
    if let Err(e) = register_new_dao(&state.db_pool, treasury.as_str()).await {
        log::warn!("Failed to register new DAO in cache: {}", e);
    }

    // Fetch balance after treasury creation to track the cost
    let balance_after = Tokens::account(state.signer_id.clone())
        .near_balance()
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            eprintln!("Error fetching near balance: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    // Send success notification
    let conf_label = if is_confidential {
        " (confidential)"
    } else {
        ""
    };
    let message = format!(
        "Treasury created{conf_label}: {treasury}\nBalance after: {}",
        balance_after.total
    );
    if let Err(e) = state.telegram_client.send_message(&message).await {
        log::warn!("Failed to send Telegram notification: {}", e);
    }

    Ok(Json(CreateTreasuryResponse { treasury }))
}
