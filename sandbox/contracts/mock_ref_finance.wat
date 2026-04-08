;; Mock v2.ref-finance.near for sandbox testing.
;;
;; Returns a hardcoded whitelist of token contracts for get_whitelisted_tokens.

(module
  ;; NEAR host: value_return(value_len: u64, value_ptr: u64)
  (import "env" "value_return" (func $value_return (param i64 i64)))

  (memory (export "memory") 1)

  ;; JSON array of whitelisted token contracts (40 bytes at offset 0)
  (data (i32.const 0)
    "[\"wrap.near\",\"intents.near\",\"v1.signer\"]"
  )

  ;; get_whitelisted_tokens() — returns the token whitelist
  (func (export "get_whitelisted_tokens")
    (call $value_return (i64.const 40) (i64.const 0))
  )
)
