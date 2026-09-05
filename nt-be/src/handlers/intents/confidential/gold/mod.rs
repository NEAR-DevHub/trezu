//! Gold layer: projected history events and dirty cursors.

pub mod cursors;
pub mod history_events;

pub use cursors::{
    mark_backfilled_confidential_daos_gold_dirty, mark_gold_dirty_for_history_event,
    mark_gold_dirty_tx,
};
pub use history_events::{
    GoldProjector, project_confidential_gold_for_dao, project_confidential_gold_for_dirty_daos,
    refresh_gold_metadata_for_intent, verify_confidential_ledger_heads,
};
