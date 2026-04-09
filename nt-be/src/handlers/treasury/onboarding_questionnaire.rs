use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::AppState;

use super::create::OnboardingQuestionnaire;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOnboardingQuestionnaireRequest {
    pub onboarding_session_id: Option<String>,
    pub questionnaire: OnboardingQuestionnaire,
    pub completed_steps: i32,
    pub account_id: Option<String>,
    pub treasury_account_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOnboardingQuestionnaireResponse {
    pub onboarding_session_id: String,
}

pub async fn save_onboarding_questionnaire(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SaveOnboardingQuestionnaireRequest>,
) -> Result<Json<SaveOnboardingQuestionnaireResponse>, (StatusCode, Json<serde_json::Value>)> {
    let onboarding_session_id = payload
        .onboarding_session_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let questionnaire = serde_json::to_value(&payload.questionnaire).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Invalid questionnaire payload: {e}") })),
        )
    })?;

    sqlx::query!(
        r#"
        INSERT INTO onboarding_sessions (
            onboarding_session_id,
            account_id,
            treasury_account_id,
            completed_steps,
            answers
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (onboarding_session_id)
        DO UPDATE SET
            account_id = COALESCE(
                EXCLUDED.account_id,
                onboarding_sessions.account_id
            ),
            treasury_account_id = COALESCE(
                EXCLUDED.treasury_account_id,
                onboarding_sessions.treasury_account_id
            ),
            completed_steps = GREATEST(
                onboarding_sessions.completed_steps,
                EXCLUDED.completed_steps
            ),
            answers = EXCLUDED.answers,
            updated_at = NOW()
        "#,
        onboarding_session_id,
        payload.account_id,
        payload.treasury_account_id,
        payload.completed_steps,
        questionnaire
    )
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save onboarding questionnaire: {e}") })),
        )
    })?;

    Ok(Json(SaveOnboardingQuestionnaireResponse {
        onboarding_session_id,
    }))
}
