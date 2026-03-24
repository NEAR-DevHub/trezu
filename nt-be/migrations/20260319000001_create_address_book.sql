CREATE TABLE address_book (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dao_id      VARCHAR(128) NOT NULL REFERENCES monitored_accounts(account_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    networks    TEXT[] NOT NULL DEFAULT '{}',
    address     TEXT NOT NULL,
    note        TEXT NULL,
    created_by  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_address_book_dao_address ON address_book(dao_id, address);
CREATE INDEX idx_address_book_dao_id ON address_book(dao_id);
CREATE INDEX idx_address_book_created_by ON address_book(created_by);
