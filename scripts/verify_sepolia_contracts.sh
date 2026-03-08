#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="${1:-${MANIFEST_PATH:-$ROOT_DIR/deployments/sepolia.latest.json}}"
ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:?ETHERSCAN_API_KEY is required}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Deployment manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

readarray -t DEPLOYMENT_VALUES < <(python3 - "$MANIFEST_PATH" <<'PY'
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    payload = json.load(fh)
print(payload['usdcAddress'])
print(payload['marketAddress'])
print(payload['ownerAddress'])
PY
)

USDC_ADDRESS="${DEPLOYMENT_VALUES[0]}"
MARKET_ADDRESS="${DEPLOYMENT_VALUES[1]}"
OWNER_ADDRESS="${DEPLOYMENT_VALUES[2]}"
CONSTRUCTOR_ARGS=$(cast abi-encode 'constructor(address,address)' "$USDC_ADDRESS" "$OWNER_ADDRESS")

cd "$ROOT_DIR"
forge verify-contract --chain sepolia --watch --etherscan-api-key "$ETHERSCAN_API_KEY" "$USDC_ADDRESS" src/mocks/MockUSDC.sol:MockUSDC
forge verify-contract --chain sepolia --watch --etherscan-api-key "$ETHERSCAN_API_KEY" --constructor-args "$CONSTRUCTOR_ARGS" "$MARKET_ADDRESS" src/PrivatePredictionMarket.sol:PrivatePredictionMarket

printf 'Verified MockUSDC: %s\n' "$USDC_ADDRESS"
printf 'Verified PrivatePredictionMarket: %s\n' "$MARKET_ADDRESS"
