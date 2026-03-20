use axum::{
    Json,
    extract::{Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{AppState, auth::AuthUser};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAddressBookQuery {
    pub dao_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAddressBookEntryRequest {
    pub name: String,
    pub networks: Vec<String>,
    pub address: String,
    pub note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAddressBookRequest {
    pub dao_id: String,
    pub entries: Vec<CreateAddressBookEntryRequest>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AddressBookEntry {
    pub id: Uuid,
    pub dao_id: String,
    pub name: String,
    pub networks: Vec<String>,
    pub address: String,
    pub note: Option<String>,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Row returned by the fetch queries (list + export) with joined wallet.
#[derive(sqlx::FromRow)]
struct AddressBookRow {
    id: Uuid,
    dao_id: String,
    name: String,
    networks: Vec<String>,
    address: String,
    note: Option<String>,
    created_by_wallet: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<AddressBookRow> for AddressBookEntry {
    fn from(r: AddressBookRow) -> Self {
        AddressBookEntry {
            id: r.id,
            dao_id: r.dao_id,
            name: r.name,
            networks: r.networks,
            address: r.address,
            note: r.note,
            created_by: r.created_by_wallet,
            created_at: r.created_at,
        }
    }
}

/// Row returned by INSERT RETURNING (no wallet join needed).
#[derive(sqlx::FromRow)]
struct InsertedAddressBookRow {
    id: Uuid,
    dao_id: String,
    name: String,
    networks: Vec<String>,
    address: String,
    note: Option<String>,
    created_at: DateTime<Utc>,
}

pub async fn list_address_book(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Query(params): Query<ListAddressBookQuery>,
) -> Result<Json<Vec<AddressBookEntry>>, (StatusCode, String)> {
    auth_user
        .verify_dao_member(&state.db_pool, &params.dao_id)
        .await
        .map_err(|_| (StatusCode::FORBIDDEN, "Not a DAO policy member".to_string()))?;

    let entries = sqlx::query_as!(
        AddressBookRow,
        r#"
        SELECT ab.id, ab.dao_id, ab.name, ab.networks, ab.address, ab.note, ab.created_at,
               u.account_id AS created_by_wallet
        FROM address_book ab
        LEFT JOIN users u ON u.id = ab.created_by
        WHERE ab.dao_id = $1
        ORDER BY ab.created_at DESC
        "#,
        params.dao_id
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        log::error!("Failed to list address book for {}: {}", params.dao_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to fetch address book".to_string(),
        )
    })?
    .into_iter()
    .map(AddressBookEntry::from)
    .collect();

    Ok(Json(entries))
}

pub async fn create_address_book_entries(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(req): Json<CreateAddressBookRequest>,
) -> Result<Json<Vec<AddressBookEntry>>, (StatusCode, String)> {
    if req.entries.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "entries must not be empty".to_string(),
        ));
    }

    auth_user
        .verify_dao_member(&state.db_pool, &req.dao_id)
        .await
        .map_err(|_| (StatusCode::FORBIDDEN, "Not a DAO policy member".to_string()))?;

    let user_id = sqlx::query_scalar!(
        "SELECT id FROM users WHERE account_id = $1",
        auth_user.account_id
    )
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        log::error!("Failed to look up user {}: {}", auth_user.account_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to look up user".to_string(),
        )
    })?;

    let mut created = Vec::with_capacity(req.entries.len());
    for entry in req.entries {
        let row = sqlx::query_as!(
            InsertedAddressBookRow,
            r#"
            INSERT INTO address_book (dao_id, name, networks, address, note, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (dao_id, address) DO NOTHING
            RETURNING id, dao_id, name, networks, address, note, created_at
            "#,
            req.dao_id,
            entry.name,
            &entry.networks,
            entry.address,
            entry.note,
            user_id,
        )
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|e| {
            log::error!("Failed to create address book entry: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create address book entry".to_string(),
            )
        })?;

        if let Some(row) = row {
            created.push(AddressBookEntry {
                id: row.id,
                dao_id: row.dao_id,
                name: row.name,
                networks: row.networks,
                address: row.address,
                note: row.note,
                created_by: Some(auth_user.account_id.clone()),
                created_at: row.created_at,
            });
        }
    }

    Ok(Json(created))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAddressBookQuery {
    pub dao_id: String,
    /// Comma-separated list of UUIDs to export; omit to export all
    pub ids: Option<String>,
}

pub async fn export_address_book(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Query(params): Query<ExportAddressBookQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    auth_user
        .verify_dao_member(&state.db_pool, &params.dao_id)
        .await
        .map_err(|_| (StatusCode::FORBIDDEN, "Not a DAO policy member".to_string()))?;

    let ids: Option<Vec<Uuid>> = params
        .ids
        .as_deref()
        .map(|s| s.split(',').filter_map(|p| p.trim().parse().ok()).collect());

    if let Some(ref v) = ids
        && v.is_empty() {
            return Err((StatusCode::BAD_REQUEST, "ids must not be empty".to_string()));
        }

    let rows: Vec<AddressBookRow> = match ids {
        Some(ids) => sqlx::query_as!(
            AddressBookRow,
            r#"
            SELECT ab.id, ab.dao_id, ab.name, ab.networks, ab.address, ab.note, ab.created_at,
                   u.account_id AS created_by_wallet
            FROM address_book ab
            LEFT JOIN users u ON u.id = ab.created_by
            WHERE ab.dao_id = $1 AND ab.id = ANY($2)
            ORDER BY ab.created_at DESC
            "#,
            params.dao_id,
            &ids
        )
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| {
            log::error!("Failed to export address book for {}: {}", params.dao_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to export address book".to_string(),
            )
        })?,
        None => sqlx::query_as!(
            AddressBookRow,
            r#"
            SELECT ab.id, ab.dao_id, ab.name, ab.networks, ab.address, ab.note, ab.created_at,
                   u.account_id AS created_by_wallet
            FROM address_book ab
            LEFT JOIN users u ON u.id = ab.created_by
            WHERE ab.dao_id = $1
            ORDER BY ab.created_at DESC
            "#,
            params.dao_id
        )
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| {
            log::error!("Failed to export address book for {}: {}", params.dao_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to export address book".to_string(),
            )
        })?,
    };

    fn csv_escape(s: &str) -> String {
        if s.contains(',') || s.contains('"') || s.contains('\n') {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    }

    let mut csv = String::from("Name,Address,Networks,Note,Created By,Created At\n");
    for row in &rows {
        let networks = row.networks.join("|");
        let note = row.note.as_deref().unwrap_or("");
        let created_by = row.created_by_wallet.as_deref().unwrap_or("");
        csv.push_str(&format!(
            "{},{},{},{},{},{}\n",
            csv_escape(&row.name),
            csv_escape(&row.address),
            csv_escape(&networks),
            csv_escape(note),
            csv_escape(created_by),
            row.created_at.format("%Y-%m-%dT%H:%M:%SZ"),
        ));
    }

    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"address-book.csv\"",
            ),
        ],
        csv,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAddressBookRequest {
    pub ids: Vec<Uuid>,
}

pub async fn delete_address_book_entries(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(req): Json<DeleteAddressBookRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if req.ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "ids must not be empty".to_string()));
    }

    let rows = sqlx::query!(
        "SELECT DISTINCT dao_id FROM address_book WHERE id = ANY($1)",
        &req.ids
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        log::error!("Failed to fetch address book entries: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to fetch address book entries".to_string(),
        )
    })?;

    if rows.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            "No matching address book entries found".to_string(),
        ));
    }

    if rows.len() > 1 {
        return Err((
            StatusCode::BAD_REQUEST,
            "All entries must belong to the same DAO".to_string(),
        ));
    }

    auth_user
        .verify_dao_member(&state.db_pool, &rows[0].dao_id)
        .await
        .map_err(|_| (StatusCode::FORBIDDEN, "Not a DAO policy member".to_string()))?;

    sqlx::query!("DELETE FROM address_book WHERE id = ANY($1)", &req.ids)
        .execute(&state.db_pool)
        .await
        .map_err(|e| {
            log::error!("Failed to delete address book entries: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete address book entries".to_string(),
            )
        })?;

    Ok(StatusCode::NO_CONTENT)
}
