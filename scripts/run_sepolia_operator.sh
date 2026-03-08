#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRE_DIR="$ROOT_DIR/cre"
AUCTION_PID=""
RESOLUTION_PID=""
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "$RESOLUTION_PID" ]]; then kill "$RESOLUTION_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$AUCTION_PID" ]]; then kill "$AUCTION_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [[ -f "$CRE_DIR/.env" ]]; then
  set -a
  source "$CRE_DIR/.env"
  set +a
fi

MANIFEST_PATH="${MANIFEST_PATH:-$ROOT_DIR/deployments/sepolia.latest.json}"
RPC_URL="${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required}"
AUTOMATION_PRIVATE_KEY="${AUTOMATION_PRIVATE_KEY:?AUTOMATION_PRIVATE_KEY is required}"
CRE_TARGET="${CRE_TARGET:-production-settings}"
START_LOCAL_SERVICES="${START_LOCAL_SERVICES:-1}"
AUCTION_PORT="${AUCTION_SERVICE_PORT:-8080}"
RESOLUTION_PORT="${RESOLUTION_SERVICE_PORT:-18081}"
AUCTION_SERVICE_URL="${AUCTION_SERVICE_URL:-http://127.0.0.1:${AUCTION_PORT}/settle-epoch}"
RESOLUTION_SERVICE_URL="${RESOLUTION_SERVICE_URL:-http://127.0.0.1:${RESOLUTION_PORT}/resolve-market}"
UPDATE_CRE_CONFIGS="${UPDATE_CRE_CONFIGS:-1}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-15}"
POST_ACTION_DELAY_SECONDS="${POST_ACTION_DELAY_SECONDS:-6}"
ONCE="${ONCE:-0}"
MARKET_IDS="${MARKET_IDS:-}"
CRE_ETH_PRIVATE_KEY="${CRE_ETH_PRIVATE_KEY:-}"
AUCTION_SERVICE_PRIVATE_KEY="${AUCTION_SERVICE_PRIVATE_KEY:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
MOCK_RESOLUTION_OUTCOME="${MOCK_RESOLUTION_OUTCOME:-}"

if [[ -z "$CRE_ETH_PRIVATE_KEY" ]]; then
  echo "CRE_ETH_PRIVATE_KEY must be set in cre/.env or the environment" >&2
  exit 1
fi

if [[ "$START_LOCAL_SERVICES" == "1" ]]; then
  if [[ -z "$AUCTION_SERVICE_PRIVATE_KEY" ]]; then
    echo "AUCTION_SERVICE_PRIVATE_KEY must be set in cre/.env or the environment when START_LOCAL_SERVICES=1" >&2
    exit 1
  fi
  if [[ -z "$GEMINI_API_KEY" && -z "$MOCK_RESOLUTION_OUTCOME" ]]; then
    echo "Either GEMINI_API_KEY or MOCK_RESOLUTION_OUTCOME must be set in cre/.env or the environment when START_LOCAL_SERVICES=1" >&2
    exit 1
  fi
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Deployment manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

readarray -t DEPLOYMENT_VALUES < <(python3 - "$MANIFEST_PATH" <<'PY'
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    payload = json.load(fh)
print(payload['marketAddress'])
print(payload['ownerAddress'])
print(payload['automationForwarder'])
PY
)

MARKET_ADDRESS="${MARKET_ADDRESS:-${DEPLOYMENT_VALUES[0]}}"
OWNER_ADDRESS="${OWNER_ADDRESS:-${DEPLOYMENT_VALUES[1]}}"
AUTOMATION_FORWARDER="${AUTOMATION_FORWARDER:-${DEPLOYMENT_VALUES[2]}}"
AUTOMATION_ADDRESS="$(cast wallet address --private-key "$AUTOMATION_PRIVATE_KEY")"
CRE_ETH_PRIVATE_KEY="${CRE_ETH_PRIVATE_KEY:-}"
AUCTION_SERVICE_PRIVATE_KEY="${AUCTION_SERVICE_PRIVATE_KEY:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
MOCK_RESOLUTION_OUTCOME="${MOCK_RESOLUTION_OUTCOME:-}"

if [[ -z "$CRE_ETH_PRIVATE_KEY" ]]; then
  echo "CRE_ETH_PRIVATE_KEY must be set in cre/.env or the environment" >&2
  exit 1
fi

if [[ "$START_LOCAL_SERVICES" == "1" ]]; then
  if [[ -z "$AUCTION_SERVICE_PRIVATE_KEY" ]]; then
    echo "AUCTION_SERVICE_PRIVATE_KEY must be set in cre/.env or the environment when START_LOCAL_SERVICES=1" >&2
    exit 1
  fi
  if [[ -z "$GEMINI_API_KEY" && -z "$MOCK_RESOLUTION_OUTCOME" ]]; then
    echo "Either GEMINI_API_KEY or MOCK_RESOLUTION_OUTCOME must be set in cre/.env or the environment when START_LOCAL_SERVICES=1" >&2
    exit 1
  fi
fi

if [[ "$AUTOMATION_ADDRESS" != "$AUTOMATION_FORWARDER" && "$AUTOMATION_ADDRESS" != "$OWNER_ADDRESS" ]]; then
  echo "AUTOMATION_PRIVATE_KEY resolves to $AUTOMATION_ADDRESS but authorized automation is owner=$OWNER_ADDRESS or automationForwarder=$AUTOMATION_FORWARDER" >&2
  exit 1
fi

if [[ "$START_LOCAL_SERVICES" == "1" ]]; then
  (
    cd "$CRE_DIR"
    AUCTION_SERVICE_PORT="$AUCTION_PORT" AUCTION_SERVICE_PRIVATE_KEY="$AUCTION_SERVICE_PRIVATE_KEY" node ./auction-service/server.mjs >"$TMP_DIR/auction.log" 2>&1
  ) &
  AUCTION_PID=$!
  (
    cd "$CRE_DIR"
    RESOLUTION_SERVICE_PORT="$RESOLUTION_PORT" GEMINI_API_KEY="$GEMINI_API_KEY" MOCK_RESOLUTION_OUTCOME="$MOCK_RESOLUTION_OUTCOME" node ./resolution-service/server.mjs >"$TMP_DIR/resolution.log" 2>&1
  ) &
  RESOLUTION_PID=$!
  services_ready=0
  for i in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:${AUCTION_PORT}/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${RESOLUTION_PORT}/health" >/dev/null 2>&1; then
      services_ready=1
      break
    fi
    if [[ $i -eq 50 ]]; then
      echo "Services failed to start within 25 seconds" >&2
      echo "Auction service log:" >&2
      cat "$TMP_DIR/auction.log" >&2 || true
      echo "Resolution service log:" >&2
      cat "$TMP_DIR/resolution.log" >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  if [[ $services_ready -eq 0 ]]; then
    echo "Services health check failed" >&2
    exit 1
  fi
  echo "Services started successfully"
fi

if [[ "$UPDATE_CRE_CONFIGS" == "1" ]]; then
  python3 - \
    "$CRE_DIR/private-market-settlement/config.staging.json" \
    "$CRE_DIR/private-market-settlement/config.production.json" \
    "$CRE_DIR/private-market-resolution/config.staging.json" \
    "$CRE_DIR/private-market-resolution/config.production.json" \
    "$MARKET_ADDRESS" \
    "$AUCTION_SERVICE_URL" \
    "$RESOLUTION_SERVICE_URL" <<'PY'
import json
import sys
settlement_staging_path, settlement_production_path, resolution_staging_path, resolution_production_path, market, auction_url, resolution_url = sys.argv[1:8]

def update_settlement(path: str):
    with open(path, 'r', encoding='utf-8') as fh:
        settlement = json.load(fh)
    settlement['marketAddress'] = market
    settlement['receiverAddress'] = market
    settlement['auctionServiceUrl'] = auction_url
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(settlement, fh, indent=2)
        fh.write('\n')

def update_resolution(path: str):
    with open(path, 'r', encoding='utf-8') as fh:
        resolution = json.load(fh)
    resolution['marketAddress'] = market
    resolution['receiverAddress'] = market
    resolution['resolutionServiceUrl'] = resolution_url
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(resolution, fh, indent=2)
        fh.write('\n')

update_settlement(settlement_staging_path)
update_settlement(settlement_production_path)
update_resolution(resolution_staging_path)
update_resolution(resolution_production_path)
PY
fi

build_market_id_array_literal() {
  if [[ -n "$MARKET_IDS" ]]; then
    python3 - "$MARKET_IDS" <<'PY'
import sys
raw = sys.argv[1]
ids = [part.strip() for part in raw.split(',') if part.strip()]
if not ids:
    print('[]')
    raise SystemExit(0)
for item in ids:
    int(item)
print('[' + ','.join(ids) + ']')
PY
    return
  fi

  local next_market_id
  next_market_id=$(cast call "$MARKET_ADDRESS" 'nextMarketId()(uint64)' --rpc-url "$RPC_URL")
  python3 - "$next_market_id" <<'PY'
import re
import sys
text = sys.argv[1]
match = re.search(r'(\d+)', text)
next_market_id = int(match.group(1)) if match else 0
if next_market_id <= 1:
    print('[]')
else:
    print('[' + ','.join(str(i) for i in range(1, next_market_id)) + ']')
PY
}

parse_check_output() {
  python3 - "$1" <<'PY'
import re
import sys
lines = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
if len(lines) < 2:
    print('false')
    print('0x')
    print('0')
    print('0')
    raise SystemExit(0)
needed = lines[0].lower()
perform_data = lines[1]
market_id = 0
epoch = 0
if needed == 'true' and perform_data.startswith('0x'):
    raw = bytes.fromhex(perform_data[2:])
    if len(raw) >= 64:
        market_id = int.from_bytes(raw[24:32], 'big')
        epoch = int.from_bytes(raw[56:64], 'big')
print(needed)
print(perform_data)
print(str(market_id))
print(str(epoch))
PY
}

extract_tx_hash_from_json() {
  python3 - "$1" <<'PY'
import json
import sys
print(json.loads(sys.argv[1])['transactionHash'])
PY
}

extract_cre_tx_hash() {
  python3 - "$1" <<'PY'
import re
import sys
text = sys.argv[1]
matches = re.findall(r'0x[0-9a-fA-F]{64}', text)
print(matches[-1] if matches else '')
PY
}

send_perform_upkeep() {
  local perform_data="$1"
  local pending_nonce
  local send_output
  pending_nonce="$(cast nonce "$AUTOMATION_ADDRESS" --block pending --rpc-url "$RPC_URL")"
  send_output="$(cast send "$MARKET_ADDRESS" 'performUpkeep(bytes)' "$perform_data" --rpc-url "$RPC_URL" --private-key "$AUTOMATION_PRIVATE_KEY" --nonce "$pending_nonce" --json 2>&1)"
  local send_exit_code=$?
  if [[ $send_exit_code -ne 0 ]]; then
    echo "performUpkeep submission failed:" >&2
    printf '%s\n' "$send_output" >&2
    return 1
  fi
  printf '%s\n' "$send_output"
}

build_cre_project_root() {
  local project_root="$TMP_DIR/cre-project"
  mkdir -p "$project_root"
  python3 - "$CRE_DIR/project.yaml" "$project_root/project.yaml" "$RPC_URL" <<'PY'
import sys
from pathlib import Path

source_path = Path(sys.argv[1])
target_path = Path(sys.argv[2])
rpc_url = sys.argv[3]
content = source_path.read_text(encoding='utf-8')
content = content.replace('${SEPOLIA_RPC_URL}', rpc_url)
target_path.write_text(content, encoding='utf-8')
PY
  printf '%s\n' "$project_root"
}

run_cre_workflow() {
  local workflow_dir="$1"
  local trigger_tx_hash="$2"
  local label="$3"
  local cre_output
  local cre_exit_code
  local workflow_path="$CRE_DIR/${workflow_dir#./}"
  local cre_project_root
  cre_project_root="$(build_cre_project_root)"
  pushd "$CRE_DIR" >/dev/null
  cre_output=$(CRE_ETH_PRIVATE_KEY="$CRE_ETH_PRIVATE_KEY" cre workflow simulate "$workflow_path" --project-root "$cre_project_root" --target "$CRE_TARGET" --non-interactive --trigger-index 0 --evm-tx-hash "$trigger_tx_hash" --evm-event-index 0 --broadcast 2>&1)
  cre_exit_code=$?
  popd >/dev/null
  if [[ $cre_exit_code -ne 0 ]]; then
    echo "CRE workflow failed for $label with exit code $cre_exit_code:" >&2
    printf '%s\n' "$cre_output" >&2
    exit 1
  fi
  printf '%s\n' "$cre_output"
  local cre_tx_hash
  cre_tx_hash=$(extract_cre_tx_hash "$cre_output")
  if [[ -z "$cre_tx_hash" ]]; then
    echo "Failed to extract CRE transaction hash for $label" >&2
    printf 'CRE output: %s\n' "$cre_output" >&2
    exit 1
  fi
  local receipt_status
  receipt_status=$(cast receipt "$cre_tx_hash" --rpc-url "$RPC_URL" | awk '/status/ {print $2; exit}')
  if [[ "$receipt_status" != "1" ]]; then
    echo "$label CRE broadcast reverted: $cre_tx_hash" >&2
    exit 1
  fi
  printf '%s CRE tx: %s\n' "$label" "$cre_tx_hash"
}

process_once() {
  local market_id_array
  market_id_array=$(build_market_id_array_literal)
  if [[ "$market_id_array" == "[]" ]]; then
    echo "No markets discovered yet."
    return 1
  fi

  local check_data
  check_data=$(cast abi-encode 'x(uint64[])' "$market_id_array")
  local check_output
  check_output=$(cast call "$MARKET_ADDRESS" 'checkUpkeep(bytes)(bool,bytes)' "$check_data" --rpc-url "$RPC_URL")

  readarray -t CHECK_VALUES < <(parse_check_output "$check_output")
  local upkeep_needed="${CHECK_VALUES[0]}"
  local perform_data="${CHECK_VALUES[1]}"
  local market_id="${CHECK_VALUES[2]}"
  local epoch="${CHECK_VALUES[3]}"

  if [[ "$upkeep_needed" != "true" || "$perform_data" == "0x" ]]; then
    return 1
  fi

  local label="resolution"
  local workflow_dir="./private-market-resolution"
  if [[ "$epoch" != "0" ]]; then
    label="settlement"
    workflow_dir="./private-market-settlement"
  fi

  printf 'Triggering %s for market %s epoch %s\n' "$label" "$market_id" "$epoch"
  local perform_output
  perform_output=$(send_perform_upkeep "$perform_data") || return 1
  local perform_tx_hash
  perform_tx_hash=$(extract_tx_hash_from_json "$perform_output")
  if [[ -z "$perform_tx_hash" ]]; then
    echo "Failed to extract performUpkeep transaction hash" >&2
    printf 'performUpkeep output: %s\n' "$perform_output" >&2
    return 1
  fi
  printf 'performUpkeep tx: %s\n' "$perform_tx_hash"

  run_cre_workflow "$workflow_dir" "$perform_tx_hash" "$label"
  return 0
}

printf 'Monitoring market contract: %s\n' "$MARKET_ADDRESS"
printf 'Authorized automation signer: %s\n' "$AUTOMATION_ADDRESS"
printf 'CRE target: %s\n' "$CRE_TARGET"
printf 'Auction service: %s\n' "$AUCTION_SERVICE_URL"
printf 'Resolution service: %s\n' "$RESOLUTION_SERVICE_URL"

while true; do
  processed_any=0
  while process_once; do
    processed_any=1
    sleep "$POST_ACTION_DELAY_SECONDS"
  done

  if [[ "$ONCE" == "1" ]]; then
    break
  fi

  if [[ "$processed_any" == "0" ]]; then
    sleep "$POLL_INTERVAL_SECONDS"
  fi
done
