//! Recovery read for a submission: what the SSE event would have said.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use uuid::Uuid;

use crate::{AppState, auth::OptionalAuthUser};

use super::{models::RelaySubmissionStatus, store::RelayStore};

pub async fn get_relay_submission(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Path(submission_id): Path<Uuid>,
) -> Result<Json<RelaySubmissionStatus>, (StatusCode, String)> {
    let store = RelayStore::new(&state.db_pool);
    let operation = store
        .operation(submission_id)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "unknown submission".to_owned()))?;
    user.verify_member_if_confidential(&state.db_pool, operation.treasury_id.as_ref())
        .await?;
    let transactions = store
        .transactions_of(submission_id)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(RelaySubmissionStatus::from_rows(
        &operation,
        &transactions,
    )))
}
