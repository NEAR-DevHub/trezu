//! Durable sponsored relays.
//!
//! - [`models`] — row types, states, step keys, the client-facing status.
//! - [`store`] — fenced reads and writes on `relay_operations` /
//!   `relay_transactions`, lane locks.
//! - [`lanes`] — the sponsor access keys, one in-flight transaction each.
//! - [`rpc`] — provider-by-provider `send_tx` / `tx` / access-key calls.
//! - [`intake`] — the request path behind `DURABLE_RELAY_SUBMISSIONS`: insert
//!   the row, wake the worker, watch the row.
//! - [`engine`] — the worker loop: claim, run the stage, defer, finish with
//!   the accounting.
//! - [`stages`] — one file per stage of an operation.
//! - [`plan`] — the parsed payload the stages work from.
//! - [`health`] — stall checks and the orphan sweep.
//! - [`status`] — `GET /api/relay/submissions/{id}`.
//! - [`admin`] — operator endpoints: list unfinished, retrigger, resume.

pub mod admin;
pub mod engine;
pub mod health;
pub mod intake;
pub mod lanes;
pub mod models;
pub mod plan;
pub mod rpc;
pub mod stages;
pub mod status;
pub mod store;

pub use models::*;
pub use store::{InsertedOperation, RelayStore, RelayStoreError};
