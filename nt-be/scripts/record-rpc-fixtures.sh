#!/usr/bin/env bash
# Record RPC fixtures for integration tests.
#
# This starts the caching proxy in RECORD mode, runs the full test suite
# through it, then kills the proxy. Cached responses are written to
# tests/fixtures/rpc_cache/ and should be committed to the repo.
#
# Prerequisites:
#   - .env with FASTNEAR_API_KEY set
#   - PostgreSQL test database running (docker compose up -d postgres_test)
#
# Usage:
#   ./scripts/record-rpc-fixtures.sh

set -euo pipefail
cd "$(dirname "$0")/.."

CACHE_DIR="tests/fixtures/rpc_cache"
PROXY_PORT=18552
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"

echo "==> Building cache proxy..."
cargo build --bin rpc_cache_proxy 2>&1 | tail -3

echo "==> Starting cache proxy (RECORD mode)..."
RECORD=1 CACHE_DIR="$CACHE_DIR" PORT=$PROXY_PORT \
  cargo run --bin rpc_cache_proxy &
PROXY_PID=$!

# Wait for proxy to be ready
for i in $(seq 1 30); do
  if curl -s "${PROXY_URL}/near-rpc/" > /dev/null 2>&1; then
    echo "==> Proxy ready (pid ${PROXY_PID})"
    break
  fi
  sleep 0.5
done

cleanup() {
  echo "==> Stopping proxy..."
  kill $PROXY_PID 2>/dev/null || true
  wait $PROXY_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Running tests through proxy..."
# Use the test database to avoid shortcutting via dev DB data.
# Some tests (e.g. binary search) only hit RPC when the DB is empty.
DATABASE_URL="postgresql://treasury_test:test_password@localhost:5433/treasury_test_db" \
NEAR_RPC_URL="${PROXY_URL}/near-rpc" \
NEAR_ARCHIVAL_RPC_URL="${PROXY_URL}/near-archival" \
TRANSFER_HINTS_BASE_URL="${PROXY_URL}/fastnear-hints" \
NEARDATA_BASE_URL="${PROXY_URL}/neardata" \
INTENTS_EXPLORER_API_URL="${PROXY_URL}/intents-explorer/api/v0" \
  cargo test --lib --bins --tests 2>&1 | tail -30

CACHED=$(ls -1 "$CACHE_DIR"/*.json 2>/dev/null | wc -l)
echo ""
echo "==> ${CACHED} responses cached in ${CACHE_DIR}/"

echo "==> Compressing fixtures..."
ARCHIVE="tests/fixtures/rpc_cache.tar"
tar -cf "$ARCHIVE" -C tests/fixtures rpc_cache
zstd -f --rm -19 "$ARCHIVE" -o "${ARCHIVE}.zst"
echo "==> Done! Archive: $(ls -lh "${ARCHIVE}.zst" | awk '{print $5}')"
echo "==> Commit ${ARCHIVE}.zst to the repo."
