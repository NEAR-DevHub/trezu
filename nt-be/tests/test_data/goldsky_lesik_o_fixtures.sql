-- Goldsky indexed_dao_outcomes fixtures for lesik_o.sputnik-dao.near
-- Extracted from live Neon DB (pipeline with executor_id filter)
-- 14 outcomes total:
--   4 sponsor call pairs (8 outcomes) - matched via receiver_id
--   3 executor_id matched add_proposal outcomes to olskik.near
--   3 executor_id matched act_proposal outcomes to olskik.near
--
-- Block timeline:
--   188066398: sponsor call pair (add_proposal relay)
--   188066404: add_proposal execution (proposal ID 48, "NDg=") ← executor_id match
--   188066564: sponsor call pair (act_proposal relay)
--   188066574: act_proposal execution (SuccessReceiptId → FT transfer?) ← executor_id match
--   188066730: sponsor call pair (add_proposal relay)
--   188066736: add_proposal execution (proposal ID 49, "NDk=") ← executor_id match
--   188066765: sponsor call pair (act_proposal relay)
--   188066771: act_proposal execution (SuccessReceiptId → FT transfer?) ← executor_id match

-- Block 188066398: sponsor call pair (add_proposal relay)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('3Aa4dstNNiCcTsVSEr3zQtY7UFRFKMsTnqFYUeJbyPAV', 'sponsor.trezu.near', '', '{"SuccessReceiptId":"SA225FUXBCKVFyEiG8hi7HR9YsPmprytxae42S2wpLa"}', '3Aa4dstNNiCcTsVSEr3zQtY7UFRFKMsTnqFYUeJbyPAV', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066398, '6hRwAVWE89vpBaX61vyJGnvsk27C8U3c1Fryt6mTZA3o', 1772623613898);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('SA225FUXBCKVFyEiG8hi7HR9YsPmprytxae42S2wpLa', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":""}', '3Aa4dstNNiCcTsVSEr3zQtY7UFRFKMsTnqFYUeJbyPAV', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066398, '6hRwAVWE89vpBaX61vyJGnvsk27C8U3c1Fryt6mTZA3o', 1772623613898);

-- Block 188066404: add_proposal execution (proposal ID 48) ← NEW: executor_id match
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('DjiEf5cwKMzsPsejeNPiBaawr9QBmzr3St3f56UPq44v', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":"NDg="}', 'FAsG2tbbLYbhtc7NkhB2xQ9Ttwg1V2Nt93ppKcSLCjTb', 'sponsor.trezu.near', 'olskik.near', 2449355698865, 244935569886500000000, 188066404, 'DpdBkhruZzmeafuSUdc6TTLNjxxeThHFvDXZwPii95ME', 1772623617359);

-- Block 188066564: sponsor call pair (act_proposal relay)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('E2caYDmDz5q59UZfgYx84Eqx1tngJeknUzBh8N4DVhck', 'sponsor.trezu.near', '', '{"SuccessReceiptId":"A5z725zLLrgP9bUHw9CisKFwJSkQyXFsrSg4NYa8Tfv2"}', 'E2caYDmDz5q59UZfgYx84Eqx1tngJeknUzBh8N4DVhck', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066564, '967oaQ5Ce5VpGi2LoUy1pBRrbFsCzC7qQXYC6hTEAYAR', 1772623712376);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('A5z725zLLrgP9bUHw9CisKFwJSkQyXFsrSg4NYa8Tfv2', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":""}', 'E2caYDmDz5q59UZfgYx84Eqx1tngJeknUzBh8N4DVhck', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066564, '967oaQ5Ce5VpGi2LoUy1pBRrbFsCzC7qQXYC6hTEAYAR', 1772623712376);

-- Block 188066574: act_proposal execution (cross-contract receipt) ← NEW: executor_id match
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('2Ucf7fQPbZEbdyPFvqirPLuKyBqyvcFFb6TKU4D99C2j', 'lesik_o.sputnik-dao.near', '', '{"SuccessReceiptId":"9TUPmRbn1mfteET6qakEcknWvibcxa5ywhv6dXhfxCZg"}', 'Cp1Gfzd6BVDBYoThBp61GV5XjFwaw3EuTufbC3sSt1Fz', 'sponsor.trezu.near', 'olskik.near', 2752304163155, 275230416315500000000, 188066574, 'GPaev2rKXAJ9f4AT6F1RuTip7WG7sfJuxAi93tjw4otR', 1772623718249);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('7ZkrNn1Yonmg33Pk2dqJRjBMttq4iSoC1vwRBKCJHVpx', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":""}', 'Cp1Gfzd6BVDBYoThBp61GV5XjFwaw3EuTufbC3sSt1Fz', 'sponsor.trezu.near', 'olskik.near', 3438624083008, 343862408300800000000, 188066574, 'GPaev2rKXAJ9f4AT6F1RuTip7WG7sfJuxAi93tjw4otR', 1772623718249);

-- Block 188066730: sponsor call pair (add_proposal relay)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('7VJae8SR51hDS36GfhFLQxpC7WjFGeHGLVJr3D2tVetd', 'sponsor.trezu.near', '', '{"SuccessReceiptId":"FCT3D48H8Nz8nE2rgwwtyPTqDHohMCy4CREt2HH2bqnX"}', '7VJae8SR51hDS36GfhFLQxpC7WjFGeHGLVJr3D2tVetd', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066730, 'BB9TKTYXsxMaeBgdNTkZL8c8GaA9Jzc4MQMdYWrV8Hga', 1772623813299);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('FCT3D48H8Nz8nE2rgwwtyPTqDHohMCy4CREt2HH2bqnX', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":""}', '7VJae8SR51hDS36GfhFLQxpC7WjFGeHGLVJr3D2tVetd', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066730, 'BB9TKTYXsxMaeBgdNTkZL8c8GaA9Jzc4MQMdYWrV8Hga', 1772623813299);

-- Block 188066736: add_proposal execution (proposal ID 49) ← NEW: executor_id match
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('78gzQunbk4QNUzkavwyViYEbZBYZKprMYxjCLkP5WW8W', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":"NDk="}', 'Gk7N5puHhQLJtecWFYQKouCG897sxsXxf8ieNh7uE8PL', 'sponsor.trezu.near', 'olskik.near', 2412187314309, 241218731430900000000, 188066736, 'GeJkd6BbEj7nwnBRKzBUGiyyCkDEQttLkKbNHQy2rNGr', 1772623817154);

-- Block 188066765: sponsor call pair (act_proposal relay)
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('7CqvMgwQNFvLpuYjUbSFmypn6YPMdLdL8DkRyQkBAtGm', 'sponsor.trezu.near', '', '{"SuccessReceiptId":"7uyU2ZYxtKPgWV5rR6RnDGN2PUvCYe5jTnrEj3tY4jz1"}', '7CqvMgwQNFvLpuYjUbSFmypn6YPMdLdL8DkRyQkBAtGm', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066765, 'fmB1TFnnK6BFiAgUV4VRYU2Dp1h3EvkkzP8SSxTGZ5P', 1772623835046);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('7uyU2ZYxtKPgWV5rR6RnDGN2PUvCYe5jTnrEj3tY4jz1', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":""}', '7CqvMgwQNFvLpuYjUbSFmypn6YPMdLdL8DkRyQkBAtGm', 'sponsor.trezu.near', 'lesik_o.sputnik-dao.near', 223182562500, 22318256250000000000, 188066765, 'fmB1TFnnK6BFiAgUV4VRYU2Dp1h3EvkkzP8SSxTGZ5P', 1772623835046);

-- Block 188066771: act_proposal execution (cross-contract receipt) ← NEW: executor_id match
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('AvXBQ7vqaE8ZqVwmbSppRPLXABcJMzJtLCpTD1xow5sF', 'lesik_o.sputnik-dao.near', '', '{"SuccessValue":""}', 'DCkNRgGzECydEiLsgSTxEzkWQK8WGhLRksRdZPrFBRhx', 'sponsor.trezu.near', 'olskik.near', 3345989641824, 334598964182400000000, 188066771, '3xfV6XsJB5fMrmYQyaPJKJLkBFDhhygMKwPHHbMz72eR', 1772623838269);
INSERT INTO indexed_dao_outcomes (id, executor_id, logs, status, transaction_hash, signer_id, receiver_id, gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp) VALUES ('BRWhm2AX4pwYYyaLqLxPb9vierJNaZxJPjRHE1RyQTWM', 'lesik_o.sputnik-dao.near', '', '{"SuccessReceiptId":"5MB9b89KrtNKFgw8EkuaMrnZhtp8JyGzwpds5DQtpULG"}', 'DCkNRgGzECydEiLsgSTxEzkWQK8WGhLRksRdZPrFBRhx', 'sponsor.trezu.near', 'olskik.near', 2665782519411, 266578251941100000000, 188066771, '3xfV6XsJB5fMrmYQyaPJKJLkBFDhhygMKwPHHbMz72eR', 1772623838269);
