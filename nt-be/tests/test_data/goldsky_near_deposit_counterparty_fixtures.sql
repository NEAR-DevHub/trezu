-- Goldsky indexed_dao_outcomes fixtures for olskik-test.sputnik-dao.near
-- NEAR deposit: 0.1 NEAR received from testing-astradao.sputnik-dao.near
-- Extracted from live Goldsky DB on 2026-03-23
--
-- Reproduces the bug where the counterparty is incorrectly set to the last
-- approver (yurtur.near via meta-tx receiver_id) instead of the actual sender
-- DAO (testing-astradao.sputnik-dao.near) which created the Transfer receipt.
--
-- Transaction: 4ZM64KR7WgKExWn4TcBvwHWBuC4NjnUd9MWzxskHrEpH
-- Transfer receipt: 6VKZ63Z3BFJgWxB8fR8DBgqfHqBtbs5mdCLj43XBzwzE
--   predecessor: testing-astradao.sputnik-dao.near
--   receiver: olskik-test.sputnik-dao.near
--   action: Transfer 0.1 NEAR
--
-- Block 190792140: 3 outcomes from act_proposal execution
--   - testing-astradao processes act_proposal (SuccessValue)
--   - olskik-test receives Transfer (SuccessValue) ← the balance change
--   - testing-astradao creates the Transfer receipt (SuccessReceiptId)

-- Outcome 1: testing-astradao.sputnik-dao.near processes act_proposal
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp)
VALUES ('3pkACGYnn5RCtD2qCBtcbTPC66vXyddm96vSF9c6fcs4', 'testing-astradao.sputnik-dao.near', '', '{"SuccessValue":""}', '4ZM64KR7WgKExWn4TcBvwHWBuC4NjnUd9MWzxskHrEpH', 'sponsor.trezu.near', 'yurtur.near', 3455600838251, 345560083825100000000, 190792140, '4RbXvL6ozY2cnLJMZXFu4nFB2yqJpR23V73FGSdeMB5J', 1774267965606);

-- Outcome 2: olskik-test.sputnik-dao.near receives Transfer (balance +0.1 NEAR)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp)
VALUES ('6VKZ63Z3BFJgWxB8fR8DBgqfHqBtbs5mdCLj43XBzwzE', 'olskik-test.sputnik-dao.near', '', '{"SuccessValue":""}', '4ZM64KR7WgKExWn4TcBvwHWBuC4NjnUd9MWzxskHrEpH', 'sponsor.trezu.near', 'yurtur.near', 223182562500, 22318256250000000000, 190792140, '4RbXvL6ozY2cnLJMZXFu4nFB2yqJpR23V73FGSdeMB5J', 1774267965606);

-- Outcome 3: testing-astradao.sputnik-dao.near creates Transfer receipt
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp)
VALUES ('GRmLyvndJXX2tf2K74TRgCZPTvMR5pGvF7wsZA9YVELz', 'testing-astradao.sputnik-dao.near', '', '{"SuccessReceiptId":"7Uhz4wRhQbsc1uXgD3RnrfJ7DyEXsPQFCvTe6gf4fSPN"}', '4ZM64KR7WgKExWn4TcBvwHWBuC4NjnUd9MWzxskHrEpH', 'sponsor.trezu.near', 'yurtur.near', 2864130121809, 286413012180900000000, 190792140, '4RbXvL6ozY2cnLJMZXFu4nFB2yqJpR23V73FGSdeMB5J', 1774267965606);

-- =========================================================================
-- Outgoing NEAR: olskik-test.sputnik-dao.near sends 1 NEAR to lesik-o.sputnik-dao.near
-- Transaction: FxWS6iXr8nqYX936GSHqmfqWfxsc4QrnbbKRwtHEfRhz
-- Block 190790032: 3 outcomes from act_proposal execution
--   - olskik-test processes act_proposal (SuccessValue) ← balance -1.0 NEAR
--   - lesik-o receives Transfer (SuccessValue) ← balance +1.0 NEAR
--   - olskik-test creates Transfer receipt (SuccessReceiptId)
-- =========================================================================

-- Outcome 4: olskik-test.sputnik-dao.near processes act_proposal (balance -1.0 NEAR)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp)
VALUES ('66U9cL8MXnWEYcCGnsggdQARhS4tk8PvmuAp4Bc6NWT7', 'olskik-test.sputnik-dao.near', '', '{"SuccessValue":""}', 'FxWS6iXr8nqYX936GSHqmfqWfxsc4QrnbbKRwtHEfRhz', 'sponsor.trezu.near', 'olskik.near', 3072394684788, 307239468478800000000, 190790032, 'CV1o61PZTJcuvfrqMsJrnCvcnuPsj6kXtuCovVydvS3S', 1774266706024);

-- Outcome 5: lesik-o.sputnik-dao.near receives Transfer (balance +1.0 NEAR)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp)
VALUES ('9mSDH9ia6TJ5cQchz9XPcf5XnuqCWjc6GgFrEeut1GkA', 'lesik-o.sputnik-dao.near', '', '{"SuccessValue":""}', 'FxWS6iXr8nqYX936GSHqmfqWfxsc4QrnbbKRwtHEfRhz', 'sponsor.trezu.near', 'olskik.near', 223182562500, 22318256250000000000, 190790032, 'CV1o61PZTJcuvfrqMsJrnCvcnuPsj6kXtuCovVydvS3S', 1774266706024);

-- Outcome 6: olskik-test.sputnik-dao.near creates Transfer receipt
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp)
VALUES ('DuuWEEPmrwHgoZFeJNJcaqnUxcgSbaD7QKoc4rqhmMLB', 'olskik-test.sputnik-dao.near', '', '{"SuccessReceiptId":"XcXaNoTCjWcRbvQfAJv6JeGiVRtv7vMuqBZQQen36AL"}', 'FxWS6iXr8nqYX936GSHqmfqWfxsc4QrnbbKRwtHEfRhz', 'sponsor.trezu.near', 'olskik.near', 2499187010774, 249918701077400000000, 190790032, 'CV1o61PZTJcuvfrqMsJrnCvcnuPsj6kXtuCovVydvS3S', 1774266706024);
