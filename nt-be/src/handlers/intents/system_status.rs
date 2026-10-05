use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    AppState,
    handlers::status::oh_dear::{fetch_intents_posts, is_relevant_intents_post},
    utils::cache::{CacheKey, CacheTier},
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemStatusPost {
    pub id: String,
    pub title: String,
    /// Public incident text. Shield puts this in the incident title.
    pub message: String,
    pub post_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemStatusResponse {
    pub posts: Vec<SystemStatusPost>,
}

pub async fn get_system_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SystemStatusResponse>, (StatusCode, String)> {
    let cache_key = CacheKey::new("intents-system-status").build();
    let state_for_fetch = Arc::clone(&state);

    let posts = state
        .cache
        .cached(CacheTier::ShortTerm, cache_key, async move {
            let posts = fetch_intents_posts(&state_for_fetch).await.map_err(|e| {
                tracing::error!("Error fetching system status: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, e)
            })?;

            let now = chrono::Utc::now().timestamp_millis();
            Ok::<_, (StatusCode, String)>(SystemStatusResponse {
                posts: posts
                    .into_iter()
                    .filter(|post| is_relevant_intents_post(post.ends_at, now))
                    .map(|post| SystemStatusPost {
                        id: post.id.unwrap_or_default(),
                        message: post.title.clone(),
                        title: post.title,
                        post_type: post.post_type,
                    })
                    .collect(),
            })
        })
        .await?;

    Ok(Json(posts))
}
