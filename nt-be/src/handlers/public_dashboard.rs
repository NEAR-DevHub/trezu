use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};

use crate::{AppState, services::load_latest_public_dashboard_snapshot};

pub async fn get_public_dashboard_aum(
    State(state): State<Arc<AppState>>,
) -> Result<Json<crate::services::public_dashboard::PublicDashboardSnapshot>, (StatusCode, String)>
{
    let snapshot = load_latest_public_dashboard_snapshot(&state)
        .await
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load public dashboard snapshot: {}", err),
            )
        })?;

    snapshot.map(Json).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "Public dashboard snapshot not found".to_string(),
        )
    })
}
