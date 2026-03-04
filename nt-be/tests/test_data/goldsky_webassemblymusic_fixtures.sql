-- Goldsky indexed_dao_outcomes fixtures for webassemblymusic-treasury.sputnik-dao.near
-- Extracted from live Neon DB on 2026-03-04
-- 10 outcomes total from today's transactions:
--
-- Block timeline:
--   188101232: petersalomonsen.near sends 0.432 NEAR via add_proposal (Path B, 2 outcomes)
--   188102281: sponsor call pair — add_proposal relay (Path B, 2 outcomes)
--   188102291: executor_id outcome — act_proposal to petersalomonsen.near (Path C, 1 outcome)
--   188102389: sponsor call pair — add_proposal relay (Path B, 2 outcomes)
--   188102395: executor_id outcomes + intents mt_burn log (Path C + Path A, 3 outcomes)
--
-- Expected prod balance changes (from api.trezu.app):
--   188101233: NEAR +0.432  (Transfer from petersalomonsen.near)
--   188102293: NEAR +0.0969 (FunctionCall, act_proposal → cross-contract)
--   188102397: NEAR -0.0007 (FunctionCall, act_proposal → intents swap gas)
--   188102398: intents USDC -10 (FunctionCall, intents swap mt_burn)
--   188102401: NEAR -0.0999 (intents.near settlement)

-- Block 188101232: petersalomonsen.near sends NEAR to DAO (add_proposal)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('E2qj16xcmCcN9uFpxwBYkSLUxpYZ4yoSr4T9a7iRyds7', 'petersalomonsen.near', '', '{"SuccessReceiptId":"ENGjBrJUYWUKDfPKQZ1xCPX2AXax8F9m9sPA7nCj9TXK"}', 'E2qj16xcmCcN9uFpxwBYkSLUxpYZ4yoSr4T9a7iRyds7', 'petersalomonsen.near', 'webassemblymusic-treasury.sputnik-dao.near', 223182562500, 22318256250000000000, 188101232, 'HMKfGkb6XF5QpE9GEgsk3YAiiTWqzYuJdYnvcGDwJtan', 1772644991359);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('ENGjBrJUYWUKDfPKQZ1xCPX2AXax8F9m9sPA7nCj9TXK', 'webassemblymusic-treasury.sputnik-dao.near', '', '{"SuccessValue":""}', 'E2qj16xcmCcN9uFpxwBYkSLUxpYZ4yoSr4T9a7iRyds7', 'petersalomonsen.near', 'webassemblymusic-treasury.sputnik-dao.near', 223182562500, 22318256250000000000, 188101232, 'HMKfGkb6XF5QpE9GEgsk3YAiiTWqzYuJdYnvcGDwJtan', 1772644991359);

-- Block 188102281: sponsor call pair (add_proposal relay)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('DqUEDNguQEvGZTxHBCKv3955fUM7HoGqx8Df8JLELFBh', 'sponsor.trezu.near', '', '{"SuccessReceiptId":"8pMQHd348oKU1bDmVABJAHnwfe3KyK4PZa6Deqn6Xjdc"}', 'DqUEDNguQEvGZTxHBCKv3955fUM7HoGqx8Df8JLELFBh', 'sponsor.trezu.near', 'webassemblymusic-treasury.sputnik-dao.near', 223182562500, 22318256250000000000, 188102281, '3rr9mEoDdy3pveADxz3UJhdTa3UU4fDuaMtuu1hZRsCZ', 1772645650804);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('8pMQHd348oKU1bDmVABJAHnwfe3KyK4PZa6Deqn6Xjdc', 'webassemblymusic-treasury.sputnik-dao.near', '', '{"SuccessValue":""}', 'DqUEDNguQEvGZTxHBCKv3955fUM7HoGqx8Df8JLELFBh', 'sponsor.trezu.near', 'webassemblymusic-treasury.sputnik-dao.near', 223182562500, 22318256250000000000, 188102281, '3rr9mEoDdy3pveADxz3UJhdTa3UU4fDuaMtuu1hZRsCZ', 1772645650804);

-- Block 188102291: executor_id outcome — act_proposal execution to petersalomonsen.near (Path C)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('EM7SPtrBspK9CDef7gQDwMMCNVW3WgMtDDAxqL1N2uAJ', 'webassemblymusic-treasury.sputnik-dao.near', '', '{"SuccessValue":"NTY="}', '7d7UfRFQPrr4WFX6jStTBs8VnexECCQsaxcUVXWxXwc5', 'sponsor.trezu.near', 'petersalomonsen.near', 2451192243401, 245119224340100000000, 188102291, '7a4i78i2Tq9KemSPsnGdkz6517EpHmrFAwSGidfP7SVX', 1772645658624);

-- Block 188102389: sponsor call pair (add_proposal relay)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('Aafgf1hUm77oYc17aDdMxysRbNiG7eAe5qPPSzPvkuoG', 'sponsor.trezu.near', '', '{"SuccessReceiptId":"9tuQj5qDayqmFmcvv4Z8EjY16DK6r1Jb1QH5zGDLreFy"}', 'Aafgf1hUm77oYc17aDdMxysRbNiG7eAe5qPPSzPvkuoG', 'sponsor.trezu.near', 'webassemblymusic-treasury.sputnik-dao.near', 223182562500, 22318256250000000000, 188102389, '2KnquxdYxEnmjecQFJXR2bFAWbFECxtBrrCCaNTwdCCd', 1772645722345);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('9tuQj5qDayqmFmcvv4Z8EjY16DK6r1Jb1QH5zGDLreFy', 'webassemblymusic-treasury.sputnik-dao.near', '', '{"SuccessValue":""}', 'Aafgf1hUm77oYc17aDdMxysRbNiG7eAe5qPPSzPvkuoG', 'sponsor.trezu.near', 'webassemblymusic-treasury.sputnik-dao.near', 223182562500, 22318256250000000000, 188102389, '2KnquxdYxEnmjecQFJXR2bFAWbFECxtBrrCCaNTwdCCd', 1772645722345);

-- Block 188102395: act_proposal execution triggering intents swap (Path C + Path A)
-- 4rpZjD77: intents.near mt_burn log — Path A (intents USDC -10, mentions DAO in logs)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('4rpZjD77YaeE1fvNuPe9vjane4uaX7bBmQm1BYHoBWmP', 'intents.near', 'EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_burn","data":[{"owner_id":"webassemblymusic-treasury.sputnik-dao.near","token_ids":["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"],"amounts":["10000000"],"memo":"withdraw"}]}', '{"SuccessReceiptId":"DRuvqo7HiDQkHJkRTTJgdPjKC7kUCYAnjSkByHeZ7Rzo"}', '9noKHxN7Rj7tNhZVfZZbCRu1ZiWSq8cqDr9RAwX1TL7U', 'sponsor.trezu.near', 'petersalomonsen.near', 4513675553538, 451367555353800000000, 188102395, '58Vpn2eSbXnb38L2YEHjdxVFbe8xxZwi65xzY4c3hFYx', 1772645726569);
-- 5chj6XaV: executor_id=DAO, receiver_id=petersalomonsen.near — Path C
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('5chj6XaVkHNy4s6o1eae9HFBE6XrhJ8BsrBzXUKbybKt', 'webassemblymusic-treasury.sputnik-dao.near', '', '{"SuccessReceiptId":"HrtpuvjreL2bXrphcC4oJQbFhsw5UexEaibWfq2px2SP"}', '9noKHxN7Rj7tNhZVfZZbCRu1ZiWSq8cqDr9RAwX1TL7U', 'sponsor.trezu.near', 'petersalomonsen.near', 2713403052903, 271340305290300000000, 188102395, '58Vpn2eSbXnb38L2YEHjdxVFbe8xxZwi65xzY4c3hFYx', 1772645726569);
-- CuLGcwGq: executor_id=DAO, receiver_id=petersalomonsen.near — Path C
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('CuLGcwGqeRUS4Vt1SzgUV75prcjzZKXUfo5itdoysFqq', 'webassemblymusic-treasury.sputnik-dao.near', '', '{"SuccessValue":""}', '9noKHxN7Rj7tNhZVfZZbCRu1ZiWSq8cqDr9RAwX1TL7U', 'sponsor.trezu.near', 'petersalomonsen.near', 3394230484741, 339423048474100000000, 188102395, '58Vpn2eSbXnb38L2YEHjdxVFbe8xxZwi65xzY4c3hFYx', 1772645726569);
