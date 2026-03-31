-- Generic notification queue: one row per detected DAO event.
-- Decouples event detection (what happened) from delivery (how to send it).
CREATE TABLE dao_notifications (
    id           BIGSERIAL   PRIMARY KEY,
    dao_id       TEXT        NOT NULL,
    event_type   TEXT        NOT NULL,  -- 'add_proposal' | 'payment' | 'swap_fulfilled'
    source_id    BIGINT      NOT NULL,  -- balance_changes.id or detected_swaps.id
    source_table TEXT        NOT NULL,  -- 'balance_changes' | 'detected_swaps'
    payload      JSONB       NOT NULL,  -- event details (amount, token, counterparty, etc.)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dao_notification UNIQUE (source_table, source_id, dao_id, event_type)
);
CREATE INDEX idx_dao_notifications_dao     ON dao_notifications (dao_id);
CREATE INDEX idx_dao_notifications_created ON dao_notifications (created_at DESC);

-- Per-destination delivery tracking.
-- Each destination (telegram, email, webhook) gets its own row per notification.
-- ON CONFLICT ensures idempotent delivery on worker restart.
CREATE TABLE dao_notification_deliveries (
    id              BIGSERIAL   PRIMARY KEY,
    notification_id BIGINT      NOT NULL REFERENCES dao_notifications(id) ON DELETE CASCADE,
    destination     TEXT        NOT NULL,  -- 'telegram' | 'email' | 'webhook'
    destination_ref TEXT        NOT NULL,  -- chat_id, email address, webhook URL
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_delivery UNIQUE (notification_id, destination, destination_ref)
);
CREATE INDEX idx_deliveries_notification ON dao_notification_deliveries (notification_id);

-- Cursors for the event detection worker reuse the existing goldsky_cursors table.
-- Consumer names: 'notifications:balance_changes' and 'notifications:detected_swaps'.
-- last_processed_block stores the last processed balance_changes.id / detected_swaps.id.
