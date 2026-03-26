;; Mock v1.signer contract for sandbox testing.
;;
;; Exposes a single `sign` method that returns a hardcoded Ed25519 MPC
;; signature response, matching the real v1.signer response format:
;;
;;   {"scheme":"Ed25519","signature":[...64 bytes...]}
;;
;; The signature bytes are deterministic (not cryptographically valid) so
;; that E2E tests can assert on the exact value.

(module
  ;; NEAR host: value_return(value_len: u64, value_ptr: u64)
  (import "env" "value_return" (func $value_return (param i64 i64)))

  (memory (export "memory") 1)

  ;; The JSON response (266 bytes) embedded at offset 0
  (data (i32.const 0)
    "{\"scheme\":\"Ed25519\",\"signature\":[233,72,198,128,218,168,10,73,247,157,77,46,172,228,149,132,108,151,150,123,238,249,14,74,70,254,56,16,204,102,170,164,168,202,120,81,147,166,114,246,10,134,45,75,48,118,121,99,0,156,138,181,231,92,18,124,237,223,202,88,163,178,35,8]}"
  )

  ;; sign() — called by DAO proposals via FunctionCall
  (func (export "sign")
    (call $value_return (i64.const 266) (i64.const 0))
  )
)
