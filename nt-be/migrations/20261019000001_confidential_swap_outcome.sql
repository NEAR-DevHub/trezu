-- Latest 1Click status per deposit address is read on every Requests page
-- load (swap outcome lookup) and by the swap-status endpoint. The existing
-- unique index leads with created_at_external, so each lookup walked the
-- DAO's history backwards until it hit the address.
CREATE INDEX IF NOT EXISTS idx_bche_deposit_address_latest
    ON bronze_confidential_history_events (account_id, deposit_address, created_at_external DESC);

-- Legacy single intents whose proposal executed but whose signed intent was
-- never handed to 1Click (pre-#1846 fire-and-forget auto-submit). 1Click
-- lists the untouched quote as PENDING_DEPOSIT; 20261013000001 took that
-- history link as proof of submission and marked them done, so the submit
-- queue never revisited them and the request shows as Processing forever.
-- Hand them back to the queue as `unknown`: the per-DAO poll reconciles each
-- against 1Click and retires it as failed once its deadline has passed with
-- no deposit on record.
UPDATE confidential_intents ci
SET submit_state = 'unknown',
    submit_next_attempt_at = NOW(),
    updated_at = NOW()
FROM bronze_confidential_history_events he
WHERE he.id = ci.history_event_id
  AND UPPER(he.status) = 'PENDING_DEPOSIT'
  AND ci.intent_type = 'shield'
  AND ci.submit_state = 'done'
  AND ci.submit_result IS NULL
  AND ci.status IN ('pending', 'submitted')
  AND ci.proposal_execution_transaction_hash IS NOT NULL;

-- Legacy single intents 1Click rejected at submit time (e.g. "Quote has
-- expired") before the submit queue existed: the error was stored but the
-- row stayed `submitted`, so the request shows as Processing although nothing
-- ever reached the deposit address. Retire them the way `finish_failed` does.
UPDATE confidential_intents
SET status = 'failed',
    submit_state = 'failed',
    submit_next_attempt_at = NULL,
    submit_last_error = COALESCE(submit_last_error, submit_result->>'error'),
    updated_at = NOW()
WHERE intent_type = 'shield'
  AND status IN ('pending', 'submitted')
  AND submit_result ? 'error'
  AND proposal_execution_transaction_hash IS NOT NULL;
