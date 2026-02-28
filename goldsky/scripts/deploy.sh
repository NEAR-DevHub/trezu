#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINES_DIR="$SCRIPT_DIR/../pipelines"

echo "=== Deploying Goldsky Turbo Pipelines ==="

for yaml in "$PIPELINES_DIR"/*.yaml; do
    name=$(basename "$yaml" .yaml)
    echo ""
    echo "Deploying pipeline: $name"
    goldsky pipeline create "$yaml"
done

echo ""
echo "=== All pipelines deployed ==="
echo "Run 'goldsky pipeline list' to check status."
