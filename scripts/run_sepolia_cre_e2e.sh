#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRE_DIR="$ROOT_DIR/cre"

if [[ -f "$CRE_DIR/.env" ]]; then
  set -a
  source "$CRE_DIR/.env"
  set +a
fi

MANIFEST_PATH="${MANIFEST_PATH:-$ROOT_DIR/deployments/sepolia.latest.json}"
RPC_URL="${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required}"
OWNER_PRIVATE_KEY="${OWNER_PRIVATE_KEY:?OWNER_PRIVATE_KEY is required}"
TRADER_TWO_PRIVATE_KEY="${TRADER_TWO_PRIVATE_KEY:?TRADER_TWO_PRIVATE_KEY is required}"
AUTOMATION_PRIVATE_KEY="${AUTOMATION_PRIVATE_KEY:-$OWNER_PRIVATE_KEY}"
CRE_TARGET="${CRE_TARGET:-staging-settings}"
START_LOCAL_SERVICES="${START_LOCAL_SERVICES:-1}"
AUCTION_PORT="${AUCTION_SERVICE_PORT:-8080}"
RESOLUTION_PORT="${RESOLUTION_SERVICE_PORT:-18081}"
AUCTION_SERVICE_URL="${AUCTION_SERVICE_URL:-http://127.0.0.1:${AUCTION_PORT}/settle-epoch}"
RESOLUTION_SERVICE_URL="${RESOLUTION_SERVICE_URL:-http://127.0.0.1:${RESOLUTION_PORT}/resolve-market}"
TRADING_START_DELAY_SECONDS="${TRADING_START_DELAY_SECONDS:-90}"
TRADING_DURATION_SECONDS="${TRADING_DURATION_SECONDS:-300}"
EPOCH_LENGTH_SECONDS="${EPOCH_LENGTH_SECONDS:-180}"
MINT_AMOUNT="${MINT_AMOUNT:-1000000000}"
DEPOSIT_AMOUNT="${DEPOSIT_AMOUNT:-1000000000}"
ORDER_SIZE="${ORDER_SIZE:-100000000}"
YES_LIMIT_PRICE="${YES_LIMIT_PRICE:-600000}"
NO_LIMIT_PRICE="${NO_LIMIT_PRICE:-400000}"
PRICE_SOURCE_LABEL="${PRICE_SOURCE_LABEL:-Coinbase ETH-USD spot price}"
PRICE_API_URL="${PRICE_API_URL:-https://api.coinbase.com/v2/prices/ETH-USD/spot}"
PRICE_THRESHOLD_BPS="${PRICE_THRESHOLD_BPS:-25}"
PRICE_THRESHOLD_DIRECTION="${PRICE_THRESHOLD_DIRECTION:-up}"
MARKET_QUESTION="${MARKET_QUESTION:-}"
UPDATE_CRE_CONFIGS="${UPDATE_CRE_CONFIGS:-1}"
AUCTION_PID=""
RESOLUTION_PID=""
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "$RESOLUTION_PID" ]]; then kill "$RESOLUTION_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$AUCTION_PID" ]]; then kill "$AUCTION_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

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
print(payload['automationForwarder'])
PY
)

USDC_ADDRESS="${USDC_ADDRESS:-${DEPLOYMENT_VALUES[0]}}"
MARKET_ADDRESS="${MARKET_ADDRESS:-${DEPLOYMENT_VALUES[1]}}"
OWNER_ADDRESS="${OWNER_ADDRESS:-${DEPLOYMENT_VALUES[2]}}"
AUTOMATION_FORWARDER="${AUTOMATION_FORWARDER:-${DEPLOYMENT_VALUES[3]}}"
TRADER_TWO_ADDRESS="${TRADER_TWO_ADDRESS:-$(cast wallet address --private-key "$TRADER_TWO_PRIVATE_KEY")}" 
AUTOMATION_ADDRESS="$(cast wallet address --private-key "$AUTOMATION_PRIVATE_KEY")"
CRE_ETH_PRIVATE_KEY="${CRE_ETH_PRIVATE_KEY:-}"
MARKET_CREATED_TOPIC="$(cast keccak 'MarketCreated(uint64,address,uint64,uint64,uint64,string)')"
ORDER_SUBMITTED_TOPIC="$(cast keccak 'EncryptedOrderSubmitted(uint256,uint64,uint64,address,bytes)')"

if [[ "$AUTOMATION_ADDRESS" != "$AUTOMATION_FORWARDER" ]]; then
  echo "AUTOMATION_PRIVATE_KEY resolves to $AUTOMATION_ADDRESS but contract automationForwarder is $AUTOMATION_FORWARDER" >&2
  exit 1
fi

if [[ "$START_LOCAL_SERVICES" == "1" ]]; then
  if ! curl -fsS "http://127.0.0.1:${AUCTION_PORT}/health" >/dev/null 2>&1; then
    (
      cd "$CRE_DIR"
      AUCTION_SERVICE_PORT="$AUCTION_PORT" node ./auction-service/server.mjs >"$TMP_DIR/auction.log" 2>&1
    ) &
    AUCTION_PID=$!
  fi
  if ! curl -fsS "http://127.0.0.1:${RESOLUTION_PORT}/health" >/dev/null 2>&1; then
    (
      cd "$CRE_DIR"
      RESOLUTION_SERVICE_PORT="$RESOLUTION_PORT" node ./resolution-service/server.mjs >"$TMP_DIR/resolution.log" 2>&1
    ) &
    RESOLUTION_PID=$!
  fi
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:${AUCTION_PORT}/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${RESOLUTION_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  curl -fsS "http://127.0.0.1:${AUCTION_PORT}/health" >/dev/null
  curl -fsS "http://127.0.0.1:${RESOLUTION_PORT}/health" >/dev/null
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

extract_tx_hash_from_receipt() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

label = sys.argv[1]
raw = sys.argv[2].strip()
if not raw:
    raise SystemExit(f'{label} produced no JSON output on stdout')
try:
    receipt = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f'{label} produced malformed JSON on stdout: {raw}') from exc
tx_hash = receipt.get('transactionHash')
if not tx_hash:
    raise SystemExit(f'{label} receipt is missing transactionHash: {json.dumps(receipt)}')
print(tx_hash)
PY
}

extract_indexed_topic_uint_from_receipt() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json
import sys

label = sys.argv[1]
raw = sys.argv[2].strip()
expected_topic0 = sys.argv[3].lower()
topic_index = int(sys.argv[4])
if not raw:
    raise SystemExit(f'{label} produced no JSON output on stdout')
try:
    receipt = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f'{label} produced malformed JSON on stdout: {raw}') from exc
tx_hash = receipt.get('transactionHash', '<unknown>')
status = receipt.get('status')
logs = receipt.get('logs') or []

def as_int(value):
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value, 0)
        except ValueError:
            return None
    return None

status_int = as_int(status)
if status_int == 0:
    raise SystemExit(f'{label} transaction reverted: {tx_hash}')
if not logs:
    raise SystemExit(f'{label} receipt has no logs: {json.dumps(receipt)}')

for log in logs:
    topics = log.get('topics') or []
    if len(topics) <= topic_index:
        continue
    if str(topics[0]).lower() != expected_topic0:
        continue
    print(int(topics[topic_index], 16))
    raise SystemExit(0)

raise SystemExit(f'{label} receipt is missing expected event topic {expected_topic0}: {json.dumps(receipt)}')
PY
}

wait_for_timestamp() {
  local target="$1"
  while true; do
    local now
    now=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)
    if (( now >= target )); then
      break
    fi
    sleep 12
  done
}

NOW=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)
TRADING_START="${TRADING_START:-$((NOW + TRADING_START_DELAY_SECONDS))}"
TRADING_END="${TRADING_END:-$((TRADING_START + TRADING_DURATION_SECONDS))}"

if [[ -z "$MARKET_QUESTION" ]]; then
  readarray -t MARKET_DETAILS < <(python3 - "$PRICE_API_URL" "$PRICE_SOURCE_LABEL" "$PRICE_THRESHOLD_BPS" "$PRICE_THRESHOLD_DIRECTION" "$TRADING_END" <<'PY'
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone

price_api_url, source_label, threshold_bps_raw, direction, trading_end_raw = sys.argv[1:6]
threshold_bps = int(threshold_bps_raw)
if threshold_bps < 0:
    raise SystemExit('PRICE_THRESHOLD_BPS must be non-negative')
direction = direction.strip().lower()
if direction not in {'up', 'down'}:
    raise SystemExit("PRICE_THRESHOLD_DIRECTION must be either 'up' or 'down'")

with urllib.request.urlopen(price_api_url, timeout=15) as response:
    payload = json.load(response)

amount_raw = payload.get('data', {}).get('amount')
if amount_raw is None:
    raise SystemExit(f'Unable to read ETH-USD spot price from {price_api_url}: {json.dumps(payload)}')

reference_price = float(amount_raw)
if reference_price <= 0:
    raise SystemExit(f'ETH-USD spot price must be positive, got {reference_price}')

multiplier = 1 + (threshold_bps / 10_000)
if direction == 'up':
    target_price = reference_price * multiplier
    comparator = 'greater than or equal to'
    direction_phrase = 'rise'
else:
    target_price = reference_price / multiplier
    comparator = 'less than or equal to'
    direction_phrase = 'fall'

target_price = math.floor(target_price * 100) / 100
trading_end = int(trading_end_raw)
trading_end_iso = datetime.fromtimestamp(trading_end, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

question = (
    f'Will the {source_label} {direction_phrase} to {comparator} ${target_price:,.2f} '
    f'by {trading_end_iso}? Resolve YES only if widely reported public market data confirms '
    f'that threshold was reached by the deadline; otherwise resolve NO.'
)

print(question)
print(f'{reference_price:.2f}')
print(f'{target_price:.2f}')
print(direction)
print(trading_end_iso)
PY
  )
  MARKET_QUESTION="${MARKET_DETAILS[0]}"
  REFERENCE_PRICE_USD="${MARKET_DETAILS[1]}"
  TARGET_PRICE_USD="${MARKET_DETAILS[2]}"
  PRICE_DIRECTION="${MARKET_DETAILS[3]}"
  TRADING_END_ISO="${MARKET_DETAILS[4]}"
else
  REFERENCE_PRICE_USD="${REFERENCE_PRICE_USD:-custom}"
  TARGET_PRICE_USD="${TARGET_PRICE_USD:-custom}"
  PRICE_DIRECTION="${PRICE_THRESHOLD_DIRECTION}"
  TRADING_END_ISO="$(python3 - "$TRADING_END" <<'PY'
import sys
from datetime import datetime, timezone
print(datetime.fromtimestamp(int(sys.argv[1]), tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'))
PY
  )"
fi

printf 'Creating market question: %s\n' "$MARKET_QUESTION"
printf 'Reference ETH-USD price: %s | Target ETH-USD price: %s | Trading end: %s\n' "$REFERENCE_PRICE_USD" "$TARGET_PRICE_USD" "$TRADING_END_ISO"

CREATE_OUTPUT=$(cast send "$MARKET_ADDRESS" 'createMarket(string,address,uint64,uint64,uint64)' "$MARKET_QUESTION" "$OWNER_ADDRESS" "$TRADING_START" "$TRADING_END" "$EPOCH_LENGTH_SECONDS" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" --json)
MARKET_ID=$(extract_indexed_topic_uint_from_receipt "createMarket" "$CREATE_OUTPUT" "$MARKET_CREATED_TOPIC" 1)

cast send "$USDC_ADDRESS" 'mint(address,uint256)' "$OWNER_ADDRESS" "$MINT_AMOUNT" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
cast send "$USDC_ADDRESS" 'mint(address,uint256)' "$TRADER_TWO_ADDRESS" "$MINT_AMOUNT" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
cast send "$USDC_ADDRESS" 'approve(address,uint256)' "$MARKET_ADDRESS" "$DEPOSIT_AMOUNT" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
cast send "$MARKET_ADDRESS" 'deposit(uint256)' "$DEPOSIT_AMOUNT" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
cast send "$USDC_ADDRESS" 'approve(address,uint256)' "$MARKET_ADDRESS" "$DEPOSIT_AMOUNT" --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PRIVATE_KEY" >/dev/null
cast send "$MARKET_ADDRESS" 'deposit(uint256)' "$DEPOSIT_AMOUNT" --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PRIVATE_KEY" >/dev/null

wait_for_timestamp "$TRADING_START"

CURRENT_EPOCH=$(cast call "$MARKET_ADDRESS" 'getCurrentEpoch(uint64)(uint64)' "$MARKET_ID" --rpc-url "$RPC_URL" | awk 'match($0,/[0-9]+/){print substr($0,RSTART,RLENGTH); exit}')
if [[ -z "$CURRENT_EPOCH" || "$CURRENT_EPOCH" == "0" ]]; then
  echo "Failed to determine current epoch for market $MARKET_ID" >&2
  exit 1
fi

YES_ORDER=$(python3 - "$ORDER_SIZE" "$YES_LIMIT_PRICE" <<'PY'
import json
import sys
size, limit_price = sys.argv[1:3]
payload = {"side": "BUY", "outcome": "YES", "size": size, "limitPrice": limit_price}
print("0x" + json.dumps(payload, separators=(",", ":")).encode().hex())
PY
)
NO_ORDER=$(python3 - "$ORDER_SIZE" "$NO_LIMIT_PRICE" <<'PY'
import json
import sys
size, limit_price = sys.argv[1:3]
payload = {"side": "BUY", "outcome": "NO", "size": size, "limitPrice": limit_price}
print("0x" + json.dumps(payload, separators=(",", ":")).encode().hex())
PY
)

cast send "$MARKET_ADDRESS" 'lockEpochCollateral(uint64,uint64,uint128)' "$MARKET_ID" "$CURRENT_EPOCH" "$ORDER_SIZE" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" >/dev/null
cast send "$MARKET_ADDRESS" 'lockEpochCollateral(uint64,uint64,uint128)' "$MARKET_ID" "$CURRENT_EPOCH" "$ORDER_SIZE" --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PRIVATE_KEY" >/dev/null
YES_ORDER_OUTPUT=$(cast send "$MARKET_ADDRESS" 'submitEncryptedOrder(uint64,bytes)' "$MARKET_ID" "$YES_ORDER" --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY" --json)
NO_ORDER_OUTPUT=$(cast send "$MARKET_ADDRESS" 'submitEncryptedOrder(uint64,bytes)' "$MARKET_ID" "$NO_ORDER" --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PRIVATE_KEY" --json)
YES_ORDER_ID=$(extract_indexed_topic_uint_from_receipt "submitEncryptedOrder owner" "$YES_ORDER_OUTPUT" "$ORDER_SUBMITTED_TOPIC" 1)
NO_ORDER_ID=$(extract_indexed_topic_uint_from_receipt "submitEncryptedOrder trader_two" "$NO_ORDER_OUTPUT" "$ORDER_SUBMITTED_TOPIC" 1)

wait_for_timestamp "$((TRADING_START + (CURRENT_EPOCH * EPOCH_LENGTH_SECONDS) + 1))"

SETTLEMENT_PERFORM_DATA=$(cast abi-encode 'x(uint64,uint64)' "$MARKET_ID" "$CURRENT_EPOCH")
SETTLEMENT_REQUEST_OUTPUT=$(cast send "$MARKET_ADDRESS" 'performUpkeep(bytes)' "$SETTLEMENT_PERFORM_DATA" --rpc-url "$RPC_URL" --private-key "$AUTOMATION_PRIVATE_KEY" --json)
SETTLEMENT_REQUEST_TX_HASH=$(extract_tx_hash_from_receipt "performUpkeep settlement" "$SETTLEMENT_REQUEST_OUTPUT")

if [[ -z "$CRE_ETH_PRIVATE_KEY" ]]; then
  echo "CRE_ETH_PRIVATE_KEY must be set in cre/.env or the environment" >&2
  exit 1
fi

pushd "$CRE_DIR" >/dev/null
SETTLEMENT_CRE_OUTPUT=$(CRE_ETH_PRIVATE_KEY="$CRE_ETH_PRIVATE_KEY" cre workflow simulate ./private-market-settlement --project-root . --target "$CRE_TARGET" --non-interactive --trigger-index 0 --evm-tx-hash "$SETTLEMENT_REQUEST_TX_HASH" --evm-event-index 0 --broadcast)
popd >/dev/null
printf '%s\n' "$SETTLEMENT_CRE_OUTPUT"

OWNER_ORDER_RAW=$(cast call "$MARKET_ADDRESS" 'orders(uint256)(address,uint64,uint64,uint40,bytes)' "$YES_ORDER_ID" --rpc-url "$RPC_URL")
TRADER_TWO_ORDER_RAW=$(cast call "$MARKET_ADDRESS" 'orders(uint256)(address,uint64,uint64,uint40,bytes)' "$NO_ORDER_ID" --rpc-url "$RPC_URL")
OWNER_LOCKED_RAW=$(cast call "$MARKET_ADDRESS" 'epochReservedCollateral(uint64,uint64,address)(uint256)' "$MARKET_ID" "$CURRENT_EPOCH" "$OWNER_ADDRESS" --rpc-url "$RPC_URL")
TRADER_TWO_LOCKED_RAW=$(cast call "$MARKET_ADDRESS" 'epochReservedCollateral(uint64,uint64,address)(uint256)' "$MARKET_ID" "$CURRENT_EPOCH" "$TRADER_TWO_ADDRESS" --rpc-url "$RPC_URL")
python3 - "$TMP_DIR/auction_request.json" "$MARKET_ADDRESS" "$MARKET_ID" "$YES_ORDER_ID" "$OWNER_ORDER_RAW" "$OWNER_LOCKED_RAW" "$NO_ORDER_ID" "$TRADER_TWO_ORDER_RAW" "$TRADER_TWO_LOCKED_RAW" "$CURRENT_EPOCH" <<'PY'
import json
import re
import sys
path, market_address, market_id, owner_order_id, owner_order, owner_locked, trader_two_order_id, trader_two_order, trader_two_locked, current_epoch = sys.argv[1:11]

def parse_locked(raw: str):
    line = next((line.strip() for line in raw.splitlines() if line.strip()), '')
    match = re.match(r'(\d+)', line)
    if match is None:
        raise SystemExit(f'Failed to parse locked collateral output: {raw}')
    return match.group(1)

def parse_order(raw: str, order_id: str, locked: str):
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) != 5:
        raise SystemExit(f'Failed to parse order output: {raw}')
    trader = lines[0]
    market_match = re.match(r'(\d+)', lines[1])
    epoch_match = re.match(r'(\d+)', lines[2])
    submitted_match = re.match(r'(\d+)', lines[3])
    ciphertext = lines[4]
    if not all([market_match, epoch_match, submitted_match]):
        raise SystemExit(f'Failed numeric parse: {raw}')
    return {
        'orderId': order_id,
        'trader': trader,
        'marketId': market_match.group(1),
        'epoch': epoch_match.group(1),
        'epochLockedCollateral': locked,
        'submittedAt': submitted_match.group(1),
        'ciphertext': ciphertext,
    }
payload = {
    'marketAddress': market_address,
    'marketId': market_id,
    'epoch': current_epoch,
    'orderIds': [owner_order_id, trader_two_order_id],
    'orders': [
        parse_order(owner_order, owner_order_id, parse_locked(owner_locked)),
        parse_order(trader_two_order, trader_two_order_id, parse_locked(trader_two_locked)),
    ],
}
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(payload, fh)
PY
curl -fsS -X POST "$AUCTION_SERVICE_URL" -H 'Content-Type: application/json' --data @"$TMP_DIR/auction_request.json" > "$TMP_DIR/claims.json"
python3 - "$TMP_DIR/claims.json" "$OWNER_ADDRESS" "$OWNER_PRIVATE_KEY" "$TRADER_TWO_ADDRESS" "$TRADER_TWO_PRIVATE_KEY" > "$TMP_DIR/claim_calls.txt" <<'PY'
import json
import sys
path, owner, owner_pk, trader_two, trader_two_pk = sys.argv[1:6]
with open(path, 'r', encoding='utf-8') as fh:
    payload = json.load(fh)
for claim in payload['claims']:
    settlement = claim['settlement']
    proof = '[' + ','.join(claim['merkleProof']) + ']'
    settlement_tuple = '({},{},{},{},{},{})'.format(
        settlement['trader'],
        settlement['reservedCollateralSpent'],
        settlement['reservedCollateralRefunded'],
        settlement['collateralCredit'],
        settlement['yesSharesDelta'],
        settlement['noSharesDelta'],
    )
    trader = settlement['trader'].lower()
    if trader == owner.lower():
        private_key = owner_pk
    elif trader == trader_two.lower():
        private_key = trader_two_pk
    else:
        raise SystemExit(f'No private key configured for trader {settlement["trader"]}')
    print(private_key)
    print(payload['marketId'])
    print(payload['epoch'])
    print(settlement_tuple)
    print(proof)
PY
while read -r CLAIM_PK && read -r CLAIM_MARKET_ID && read -r CLAIM_EPOCH && read -r CLAIM_SETTLEMENT && read -r CLAIM_PROOF; do
  cast send "$MARKET_ADDRESS" 'claimEpochSettlement(uint64,uint64,(address,uint128,uint128,uint128,int128,int128),bytes32[])' "$CLAIM_MARKET_ID" "$CLAIM_EPOCH" "$CLAIM_SETTLEMENT" "$CLAIM_PROOF" --rpc-url "$RPC_URL" --private-key "$CLAIM_PK" >/dev/null
done < "$TMP_DIR/claim_calls.txt"

wait_for_timestamp "$((TRADING_END + 1))"

RESOLUTION_PERFORM_DATA=$(cast abi-encode 'x(uint64,uint64)' "$MARKET_ID" 0)
RESOLUTION_REQUEST_OUTPUT=$(cast send "$MARKET_ADDRESS" 'performUpkeep(bytes)' "$RESOLUTION_PERFORM_DATA" --rpc-url "$RPC_URL" --private-key "$AUTOMATION_PRIVATE_KEY" --json)
RESOLUTION_REQUEST_TX_HASH=$(extract_tx_hash_from_receipt "performUpkeep resolution" "$RESOLUTION_REQUEST_OUTPUT")

pushd "$CRE_DIR" >/dev/null
RESOLUTION_CRE_OUTPUT=$(CRE_ETH_PRIVATE_KEY="$CRE_ETH_PRIVATE_KEY" cre workflow simulate ./private-market-resolution --project-root . --target "$CRE_TARGET" --non-interactive --trigger-index 0 --evm-tx-hash "$RESOLUTION_REQUEST_TX_HASH" --evm-event-index 0 --broadcast)
popd >/dev/null
printf '%s\n' "$RESOLUTION_CRE_OUTPUT"

RESOLUTION_STATE=$(cast call "$MARKET_ADDRESS" 'getMarketResolutionData(uint64)(string,uint64,uint8,uint8,bool)' "$MARKET_ID" --rpc-url "$RPC_URL")
readarray -t RESOLUTION_VALUES < <(python3 - "$RESOLUTION_STATE" <<'PY'
import sys
lines = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
if len(lines) < 5:
    raise SystemExit(f'Unexpected resolution output: {sys.argv[1]}')
print(lines[-3])
print(lines[-2])
print(lines[-1].lower())
PY
)
RESOLUTION_STATUS="${RESOLUTION_VALUES[0]}"
RESOLUTION_OUTCOME="${RESOLUTION_VALUES[1]}"
RESOLUTION_REQUESTED="${RESOLUTION_VALUES[2]}"

if [[ "$RESOLUTION_STATUS" != "3" || "$RESOLUTION_REQUESTED" != "false" ]]; then
  echo "Unexpected resolution state:" >&2
  printf '%s\n' "$RESOLUTION_STATE" >&2
  exit 1
fi

WINNER_PRIVATE_KEY="$OWNER_PRIVATE_KEY"
WINNER_ADDRESS="$OWNER_ADDRESS"
if [[ "$RESOLUTION_OUTCOME" == "2" ]]; then
  WINNER_PRIVATE_KEY="$TRADER_TWO_PRIVATE_KEY"
  WINNER_ADDRESS="$TRADER_TWO_ADDRESS"
fi

cast send "$MARKET_ADDRESS" 'redeem(uint64)' "$MARKET_ID" --rpc-url "$RPC_URL" --private-key "$WINNER_PRIVATE_KEY" >/dev/null
WINNER_POSITION=$(cast call "$MARKET_ADDRESS" 'positions(uint64,address)((uint128,uint128,bool))' "$MARKET_ID" "$WINNER_ADDRESS" --rpc-url "$RPC_URL")

printf 'Market ID: %s\n' "$MARKET_ID"
printf 'Market address: %s\n' "$MARKET_ADDRESS"
printf 'USDC address: %s\n' "$USDC_ADDRESS"
printf 'Settlement request tx: %s\n' "$SETTLEMENT_REQUEST_TX_HASH"
printf 'Resolution request tx: %s\n' "$RESOLUTION_REQUEST_TX_HASH"
printf 'Resolved outcome: %s\n' "$RESOLUTION_OUTCOME"
printf 'Winner address: %s\n' "$WINNER_ADDRESS"
printf 'Winner position after redeem: %s\n' "$WINNER_POSITION"
