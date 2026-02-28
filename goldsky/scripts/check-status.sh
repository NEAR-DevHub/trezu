#!/bin/bash
set -e

echo "=== Goldsky Pipeline Status ==="
echo ""

PIPELINES=("treasury-near-receipts" "treasury-ft-events" "treasury-near-transactions")

for pipeline in "${PIPELINES[@]}"; do
    echo "--- $pipeline ---"
    goldsky pipeline status "$pipeline" 2>/dev/null || echo "  Not found or not deployed"
    echo ""
done
