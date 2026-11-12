//! Durable sponsored relays.
//!
//! - [`models`] — row types, states, step keys, the client-facing status.
//! - [`store`] — fenced reads and writes on `relay_operations` /
//!   `relay_transactions`, lane locks.
//! - [`lanes`] — the sponsor access keys, one in-flight transaction each.
//! - [`rpc`] — provider-by-provider `send_tx` / `tx` / access-key calls.
//! - [`engine`] — sign once, commit, broadcast, reconcile by hash, finish
//!   with the accounting; shared by the request path and the worker.
//! - [`intake`] — the request path behind `DURABLE_RELAY_SUBMISSIONS`.
//! - [`status`] — `GET /api/relay/submissions/{id}`.

pub mod engine;
pub mod intake;
pub mod lanes;
pub mod models;
pub mod rpc;
pub mod status;
pub mod store;

pub use models::*;
pub use store::{InsertedOperation, RelayStore, RelayStoreError};
