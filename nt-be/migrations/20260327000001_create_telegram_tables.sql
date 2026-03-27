-- Persistent record of known Telegram chats
CREATE TABLE telegram_chats (
    chat_id    bigint      NOT NULL,
    chat_title text        NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT telegram_chats_pkey PRIMARY KEY (chat_id)
);

-- Ephemeral connect tokens — one per /connect invocation, short-lived, single-use
CREATE TABLE telegram_connect_tokens (
    token      uuid        NOT NULL DEFAULT gen_random_uuid(),
    chat_id    bigint      NOT NULL REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
    used_at    timestamptz NULL,  -- set when the frontend completes the connection
    CONSTRAINT telegram_connect_tokens_pkey PRIMARY KEY (token)
);

CREATE INDEX idx_telegram_connect_tokens_chat_id ON telegram_connect_tokens (chat_id);

-- Persistent treasury <-> chat mapping; dao_id is PK = one chat per treasury
CREATE TABLE telegram_treasury_connections (
    dao_id       varchar(128) NOT NULL,
    chat_id      bigint       NOT NULL REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
    connected_by uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    connected_at timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT telegram_treasury_connections_pkey PRIMARY KEY (dao_id),
    CONSTRAINT fk_ttc_dao FOREIGN KEY (dao_id) REFERENCES monitored_accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX idx_ttc_chat_id ON telegram_treasury_connections (chat_id);

CREATE OR REPLACE FUNCTION update_telegram_chats_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_telegram_chats_updated_at
    BEFORE UPDATE ON telegram_chats
    FOR EACH ROW EXECUTE FUNCTION update_telegram_chats_updated_at();
