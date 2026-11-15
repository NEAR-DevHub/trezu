//! Sponsored relaying of Sputnik DAO proposal actions.
//!
//! The HTTP entry point is [`submit::relay_delegate_action`], which records the
//! signed action as a `relay_operations` row; the relay worker in
//! [`operations`] does the rest. Grouped by concern:
//!
//! - [`parse`] — the relay request types and the parser that decodes a delegate
//!   action (direct or `w_execute_signed`) into the homogeneous DAO operation.
//! - [`access`] — authorize the caller (identity, DAO permissions, billing).
//! - [`sponsor`] — the spend policy ([`sponsor::policy`]: limits, tier, storage
//!   cost) and the RPC retry helper.
//! - [`effects`] — the gas credit and the NEP-141 registration targets.
//! - [`operations`] — the durable store, the worker and its stages.
//! - [`confidential`] — submit confidential intents after an approving vote.

pub mod access;
pub mod confidential;
pub mod effects;
pub mod operations;
pub mod parse;
pub mod post_quantum;
pub mod sponsor;
pub mod submit;
