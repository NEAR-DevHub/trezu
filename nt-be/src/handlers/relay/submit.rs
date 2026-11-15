//! The relay endpoint: records one signed delegate action as a durable operation.

use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode, response::Response};

use crate::{
    AppState,
    auth::AuthUser,
    handlers::relay::{
        operations::{self, models::RelayProposalType},
        parse::{self, RelayError, RelayRequest, error_response},
    },
};

/// Relay a sponsored delegate action to the NEAR network.
///
/// Two shapes are accepted:
///
/// * **NEP-366 meta-transaction** — the user signs a delegate action against their
///   DAO; it is wrapped and sent to its `sender_id`, signed with the relayer key.
/// * **`w_execute_signed`** — the user's signature lives inside the wallet contract
///   call; the inner DAO proposal calls are replayed by the sponsor.
///
/// The request only records the signed action. Authorization, the deposit
/// limit, the credit and every chain call happen in the relay worker; the
/// request watches the row for the result.
#[tracing::instrument(
    level = "info",
    skip_all,
    fields(step = "relay_delegate_action", treasury_id = tracing::field::Empty)
)]
pub async fn relay_delegate_action(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(relay_request): Json<RelayRequest>,
) -> Result<Response, RelayError> {
    let RelayRequest {
        treasury_id,
        // Ignored: the sponsored storage is derived server-side from the parsed
        // proposal, never from this client-supplied number.
        storage_bytes: _,
        signed_delegate_action: raw_signed_delegate_action,
        proposal_type,
        address_book_payment,
    } = relay_request;
    tracing::Span::current().record("treasury_id", tracing::field::display(&treasury_id));

    // Decode the signed action and reject anything that is not an
    // add_proposal/act_proposal on the treasury. An ML-DSA-65 key is decoded
    // with near-primitives; ed25519 and secp256k1 stay on the near-api path.
    let parsed = parse::parse_relay(treasury_id, &raw_signed_delegate_action.0)
        .map_err(|msg| error_response(StatusCode::BAD_REQUEST, msg))?;

    operations::intake::submit(
        &state,
        &auth_user,
        raw_signed_delegate_action.0,
        parsed,
        RelayProposalType::from_hint(proposal_type.as_deref(), address_book_payment),
    )
    .await
}
