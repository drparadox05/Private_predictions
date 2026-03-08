#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRE_DIR="$ROOT_DIR/cre"
DEPLOYMENTS_DIR="$ROOT_DIR/deployments"
OUTPUT_FILE="${OUTPUT_FILE:-$DEPLOYMENTS_DIR/sepolia.latest.json}"
RPC_URL="${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required}"
DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
OWNER_ADDRESS="${OWNER_ADDRESS:-$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")}" 
AUTOMATION_FORWARDER="${AUTOMATION_FORWARDER:-$OWNER_ADDRESS}"
CRE_FORWARDER_MODE="${CRE_FORWARDER_MODE:-simulation}"
DEFAULT_CRE_FORWARDER=""
if [[ "$CRE_FORWARDER_MODE" == "simulation" ]]; then
  DEFAULT_CRE_FORWARDER="0x15fC6ae953E024d975e77382eEeC56A9101f9F88"
elif [[ "$CRE_FORWARDER_MODE" == "production" ]]; then
  DEFAULT_CRE_FORWARDER="0xF8344CFd5c43616a4366C34E3EEE75af79a74482"
fi
CRE_FORWARDER="${CRE_FORWARDER:-$DEFAULT_CRE_FORWARDER}"
UPDATE_CRE_CONFIGS="${UPDATE_CRE_CONFIGS:-1}"
AUCTION_SERVICE_URL="${AUCTION_SERVICE_URL:-http://127.0.0.1:8080/settle-epoch}"
RESOLUTION_SERVICE_URL="${RESOLUTION_SERVICE_URL:-http://127.0.0.1:18081/resolve-market}"
VERIFY_CONTRACTS="${VERIFY_CONTRACTS:-1}"

mkdir -p "$DEPLOYMENTS_DIR"

cd "$ROOT_DIR"
forge clean >/dev/null
forge build >/dev/null

USDC_JSON=$(forge create src/mocks/MockUSDC.sol:MockUSDC --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --json)
USDC_ADDRESS=$(printf '%s' "$USDC_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')
USDC_TX_HASH=$(printf '%s' "$USDC_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')

MARKET_JSON=$(forge create src/PrivatePredictionMarket.sol:PrivatePredictionMarket --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --json --constructor-args "$USDC_ADDRESS" "$OWNER_ADDRESS")
MARKET_ADDRESS=$(printf '%s' "$MARKET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')
MARKET_TX_HASH=$(printf '%s' "$MARKET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')

cast send "$MARKET_ADDRESS" 'setAutomationForwarder(address)' "$AUTOMATION_FORWARDER" --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

if [[ -n "$CRE_FORWARDER" ]]; then
  cast send "$MARKET_ADDRESS" 'setCREForwarder(address)' "$CRE_FORWARDER" --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null
fi

if [[ "$UPDATE_CRE_CONFIGS" == "1" ]]; then
  python3 - \
    "$CRE_DIR/private-market-settlement/config.staging.json" \
    "$CRE_DIR/private-market-resolution/config.staging.json" \
    "$MARKET_ADDRESS" \
    "$AUCTION_SERVICE_URL" \
    "$RESOLUTION_SERVICE_URL" <<'PY'
import json
import sys
settlement_path, resolution_path, market, auction_url, resolution_url = sys.argv[1:6]
with open(settlement_path, 'r', encoding='utf-8') as fh:
    settlement = json.load(fh)
settlement['marketAddress'] = market
settlement['receiverAddress'] = market
settlement['auctionServiceUrl'] = auction_url
with open(settlement_path, 'w', encoding='utf-8') as fh:
    json.dump(settlement, fh, indent=2)
    fh.write('\n')
with open(resolution_path, 'r', encoding='utf-8') as fh:
    resolution = json.load(fh)
resolution['marketAddress'] = market
resolution['receiverAddress'] = market
resolution['resolutionServiceUrl'] = resolution_url
with open(resolution_path, 'w', encoding='utf-8') as fh:
    json.dump(resolution, fh, indent=2)
    fh.write('\n')
PY
fi

python3 - "$OUTPUT_FILE" "$USDC_ADDRESS" "$USDC_TX_HASH" "$MARKET_ADDRESS" "$MARKET_TX_HASH" "$OWNER_ADDRESS" "$AUTOMATION_FORWARDER" "$CRE_FORWARDER" "$AUCTION_SERVICE_URL" "$RESOLUTION_SERVICE_URL" <<'PY'
import json
import os
import sys
path, usdc, usdc_tx, market, market_tx, owner, automation, cre_forwarder, auction_url, resolution_url = sys.argv[1:11]
payload = {
    'chain': 'sepolia',
    'usdcAddress': usdc,
    'usdcDeployTxHash': usdc_tx,
    'marketAddress': market,
    'marketDeployTxHash': market_tx,
    'ownerAddress': owner,
    'automationForwarder': automation,
    'creForwarder': cre_forwarder,
    'auctionServiceUrl': auction_url,
    'resolutionServiceUrl': resolution_url,
}
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=2)
    fh.write('\n')
print(json.dumps(payload, indent=2))
PY

if [[ "$VERIFY_CONTRACTS" == "1" ]]; then
  "$ROOT_DIR/scripts/verify_sepolia_contracts.sh" "$OUTPUT_FILE"
fi

printf 'Deployed MockUSDC: %s\n' "$USDC_ADDRESS"
printf 'Deployed PrivatePredictionMarket: %s\n' "$MARKET_ADDRESS"
printf 'Owner: %s\n' "$OWNER_ADDRESS"
printf 'Automation forwarder: %s\n' "$AUTOMATION_FORWARDER"
if [[ -n "$CRE_FORWARDER" ]]; then
  printf 'CRE forwarder: %s\n' "$CRE_FORWARDER"
  printf 'CRE forwarder mode: %s\n' "$CRE_FORWARDER_MODE"
else
  printf 'CRE forwarder not set. Set it before CRE report delivery.\n'
fi
printf 'Deployment manifest: %s\n' "$OUTPUT_FILE"
