//! Gold projection dirty flags (`gold_confidential_history_cursors`).

mod balance_check;
mod dirty;

pub use dirty::{
    mark_backfilled_confidential_daos_gold_dirty, mark_gold_dirty_for_history_event,
    mark_gold_dirty_tx,
};

pub(crate) use balance_check::{
    BalanceCheckState, is_balance_check_failed, load_balance_check_state,
    record_balance_check_failed, record_balance_check_passed,
};
pub(crate) use dirty::{clear_gold_dirty_if_not_advanced, mark_gold_dirty};
