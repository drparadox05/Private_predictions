#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRE_DIR="$ROOT_DIR/cre"
RPC_URL="http://127.0.0.1:18545"
ANVIL_PORT=18545
AUCTION_PORT=18080
RESOLUTION_PORT=18081
KEEP_PROCESSES="${KEEP_LOCAL_CRE_PROCESSES:-0}"
SIM_FORWARDER="0x15fC6ae953E024d975e77382eEeC56A9101f9F88"
OWNER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TRADER_TWO="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
OWNER_PK="ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
TRADER_TWO_PK="59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ANVIL_PID=""
AUCTION_PID=""
RESOLUTION_PID=""
TMP_OUTPUT="$(mktemp)"
cleanup() {
  rm -f "$TMP_OUTPUT" "$TMP_OUTPUT.anvil" "$TMP_OUTPUT.auction" "$TMP_OUTPUT.resolution" "$TMP_OUTPUT.auction_request" "$TMP_OUTPUT.claims" "$TMP_OUTPUT.claim_calls"
  if [[ "$KEEP_PROCESSES" == "1" ]]; then
    return
  fi
  if [[ -n "$RESOLUTION_PID" ]]; then kill "$RESOLUTION_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$AUCTION_PID" ]]; then kill "$AUCTION_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$ANVIL_PID" ]]; then kill "$ANVIL_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

cd "$ROOT_DIR"
forge build >/dev/null

pkill -f "node ./auction-service/server.mjs" >/dev/null 2>&1 || true
pkill -f "node ./resolution-service/server.mjs" >/dev/null 2>&1 || true
pkill -f "anvil --chain-id 11155111 --port ${ANVIL_PORT}" >/dev/null 2>&1 || true

anvil --chain-id 11155111 --port "$ANVIL_PORT" --disable-code-size-limit >"$TMP_OUTPUT.anvil" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 50); do
  if cast block latest --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
cast block latest --rpc-url "$RPC_URL" >/dev/null

(
  cd "$CRE_DIR"
  AUCTION_SERVICE_PORT="$AUCTION_PORT" node ./auction-service/server.mjs >"$TMP_OUTPUT.auction" 2>&1
) &
AUCTION_PID=$!
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${AUCTION_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
curl -fsS "http://127.0.0.1:${AUCTION_PORT}/health" >/dev/null

(
  cd "$CRE_DIR"
  RESOLUTION_SERVICE_PORT="$RESOLUTION_PORT" MOCK_RESOLUTION_OUTCOME="YES" node ./resolution-service/server.mjs >"$TMP_OUTPUT.resolution" 2>&1
) &
RESOLUTION_PID=$!
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${RESOLUTION_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
curl -fsS "http://127.0.0.1:${RESOLUTION_PORT}/health" >/dev/null

pushd "$CRE_DIR" >/dev/null
bun x cre-setup >/dev/null
popd >/dev/null

USDC_JSON=$(forge create src/mocks/MockUSDC.sol:MockUSDC --rpc-url "$RPC_URL" --private-key "$OWNER_PK" --broadcast --json)
USDC_ADDRESS=$(printf '%s' "$USDC_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')
MARKET_JSON=$(forge create src/PrivatePredictionMarket.sol:PrivatePredictionMarket --rpc-url "$RPC_URL" --private-key "$OWNER_PK" --broadcast --json --constructor-args "$USDC_ADDRESS" "$OWNER")
MARKET_ADDRESS=$(printf '%s' "$MARKET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')
FORWARDER_BYTECODE=$(forge inspect src/mocks/MockCREForwarder.sol:MockCREForwarder deployedBytecode)
cast rpc --rpc-url "$RPC_URL" anvil_setCode "$SIM_FORWARDER" "$FORWARDER_BYTECODE" >/dev/null
cast send "$MARKET_ADDRESS" 'setCREForwarder(address)' "$SIM_FORWARDER" --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null

python3 - \
  "$CRE_DIR/private-market-settlement/config.local.json" \
  "$CRE_DIR/private-market-resolution/config.local.json" \
  "$MARKET_ADDRESS" \
  "$AUCTION_PORT" \
  "$RESOLUTION_PORT" <<'PY'
import json
import sys
settlement_path, resolution_path, market, auction_port, resolution_port = sys.argv[1:6]

with open(settlement_path, 'r', encoding='utf-8') as fh:
    settlement_config = json.load(fh)
settlement_config['marketAddress'] = market
settlement_config['receiverAddress'] = market
settlement_config['auctionServiceUrl'] = f'http://127.0.0.1:{auction_port}/settle-epoch'
with open(settlement_path, 'w', encoding='utf-8') as fh:
    json.dump(settlement_config, fh, indent=2)
    fh.write('\n')

with open(resolution_path, 'r', encoding='utf-8') as fh:
    resolution_config = json.load(fh)
resolution_config['marketAddress'] = market
resolution_config['receiverAddress'] = market
resolution_config['resolutionServiceUrl'] = f'http://127.0.0.1:{resolution_port}/resolve-market'
with open(resolution_path, 'w', encoding='utf-8') as fh:
    json.dump(resolution_config, fh, indent=2)
    fh.write('\n')
PY

NOW=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)
START=$((NOW + 300))
END=$((START + 600))
EPOCH_LENGTH=60
CREATE_OUTPUT=$(cast send "$MARKET_ADDRESS" 'createMarket(string,address,uint64,uint64,uint64)' 'Will matched local simulation settle?' "$OWNER" "$START" "$END" "$EPOCH_LENGTH" --rpc-url "$RPC_URL" --private-key "$OWNER_PK" --json)
MARKET_ID=$(printf '%s' "$CREATE_OUTPUT" | python3 -c 'import json,sys; receipt=json.load(sys.stdin); print(int(receipt["logs"][0]["topics"][1],16))')

YES_ORDER=$(python3 - <<'PY'
import json
payload = {"side":"BUY","outcome":"YES","size":"100000000","limitPrice":"600000"}
print("0x" + json.dumps(payload, separators=(",", ":")).encode().hex())
PY
)
NO_ORDER=$(python3 - <<'PY'
import json
payload = {"side":"BUY","outcome":"NO","size":"100000000","limitPrice":"400000"}
print("0x" + json.dumps(payload, separators=(",", ":")).encode().hex())
PY
)

cast send "$USDC_ADDRESS" 'mint(address,uint256)' "$OWNER" 1000000000 --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null
cast send "$USDC_ADDRESS" 'mint(address,uint256)' "$TRADER_TWO" 1000000000 --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null
cast send "$USDC_ADDRESS" 'approve(address,uint256)' "$MARKET_ADDRESS" 1000000000 --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null
cast send "$MARKET_ADDRESS" 'deposit(uint256)' 1000000000 --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null
cast send "$USDC_ADDRESS" 'approve(address,uint256)' "$MARKET_ADDRESS" 1000000000 --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PK" >/dev/null
cast send "$MARKET_ADDRESS" 'deposit(uint256)' 1000000000 --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PK" >/dev/null

cast rpc --rpc-url "$RPC_URL" evm_setNextBlockTimestamp "$((START + 1))" >/dev/null
cast rpc --rpc-url "$RPC_URL" evm_mine >/dev/null
cast send "$MARKET_ADDRESS" 'lockEpochCollateral(uint64,uint64,uint128)' "$MARKET_ID" 1 100000000 --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null
cast send "$MARKET_ADDRESS" 'lockEpochCollateral(uint64,uint64,uint128)' "$MARKET_ID" 1 100000000 --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PK" >/dev/null
cast send "$MARKET_ADDRESS" 'submitEncryptedOrder(uint64,bytes)' "$MARKET_ID" "$YES_ORDER" --rpc-url "$RPC_URL" --private-key "$OWNER_PK" >/dev/null
cast send "$MARKET_ADDRESS" 'submitEncryptedOrder(uint64,bytes)' "$MARKET_ID" "$NO_ORDER" --rpc-url "$RPC_URL" --private-key "$TRADER_TWO_PK" >/dev/null
OWNER_ORDER=$(cast call "$MARKET_ADDRESS" 'orders(uint256)(address,uint64,uint64,uint40,bytes)' 1 --rpc-url "$RPC_URL")
TRADER_TWO_ORDER=$(cast call "$MARKET_ADDRESS" 'orders(uint256)(address,uint64,uint64,uint40,bytes)' 2 --rpc-url "$RPC_URL")
OWNER_LOCKED=$(cast call "$MARKET_ADDRESS" 'epochReservedCollateral(uint64,uint64,address)(uint256)' "$MARKET_ID" 1 "$OWNER" --rpc-url "$RPC_URL")
TRADER_TWO_LOCKED=$(cast call "$MARKET_ADDRESS" 'epochReservedCollateral(uint64,uint64,address)(uint256)' "$MARKET_ID" 1 "$TRADER_TWO" --rpc-url "$RPC_URL")
python3 - "$TMP_OUTPUT.auction_request" "$MARKET_ADDRESS" "$MARKET_ID" "$OWNER_ORDER" "$OWNER_LOCKED" "$TRADER_TWO_ORDER" "$TRADER_TWO_LOCKED" <<'PY'
import json
import re
import sys

path, market_address, market_id, owner_order, owner_locked, trader_two_order, trader_two_locked = sys.argv[1:8]

def parse_locked(raw: str):
    line = next((line.strip() for line in raw.splitlines() if line.strip()), "")
    match = re.match(r"(\d+)", line)
    if match is None:
        raise SystemExit(f"Failed to parse locked collateral output: {raw}")
    return match.group(1)

def parse_order(raw: str, order_id: str, locked: str):
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) != 5:
        raise SystemExit(f"Failed to parse order output: {raw}")

    trader = lines[0]
    parsed_market_id = re.match(r"(\d+)", lines[1])
    epoch = re.match(r"(\d+)", lines[2])
    submitted_at = re.match(r"(\d+)", lines[3])
    ciphertext = lines[4]
    if (
        parsed_market_id is None
        or epoch is None
        or submitted_at is None
        or not re.fullmatch(r"0x[0-9a-fA-F]{40}", trader)
        or not re.fullmatch(r"0x[0-9a-fA-F]*", ciphertext)
    ):
        raise SystemExit(f"Failed to parse order output: {raw}")

    return {
        "orderId": order_id,
        "trader": trader,
        "marketId": parsed_market_id.group(1),
        "epoch": epoch.group(1),
        "epochLockedCollateral": locked,
        "submittedAt": submitted_at.group(1),
        "ciphertext": ciphertext,
    }

payload = {
    "marketAddress": market_address,
    "marketId": market_id,
    "epoch": "1",
    "orderIds": ["1", "2"],
    "orders": [
        parse_order(owner_order, "1", parse_locked(owner_locked)),
        parse_order(trader_two_order, "2", parse_locked(trader_two_locked)),
    ],
}

with open(path, 'w', encoding='utf-8') as fh:
    json.dump(payload, fh)
PY
curl -fsS -X POST "http://127.0.0.1:${AUCTION_PORT}/settle-epoch" -H 'Content-Type: application/json' --data @"$TMP_OUTPUT.auction_request" > "$TMP_OUTPUT.claims"
cast rpc --rpc-url "$RPC_URL" evm_setNextBlockTimestamp "$((START + EPOCH_LENGTH + 1))" >/dev/null
cast rpc --rpc-url "$RPC_URL" evm_mine >/dev/null
PERFORM_DATA=$(cast abi-encode 'x(uint64,uint64)' "$MARKET_ID" 1)
PERFORM_OUTPUT=$(cast send "$MARKET_ADDRESS" 'performUpkeep(bytes)' "$PERFORM_DATA" --rpc-url "$RPC_URL" --private-key "$OWNER_PK" --json)
SETTLEMENT_TX_HASH=$(printf '%s' "$PERFORM_OUTPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')

pushd "$CRE_DIR" >/dev/null
CRE_OUTPUT=$(CRE_ETH_PRIVATE_KEY="$OWNER_PK" cre workflow simulate ./private-market-settlement --project-root . --target local-simulation --non-interactive --trigger-index 0 --evm-tx-hash "$SETTLEMENT_TX_HASH" --evm-event-index 0 --broadcast)
popd >/dev/null
printf '%s\n' "$CRE_OUTPUT"
CRE_TX_HASH=$(printf '%s\n' "$CRE_OUTPUT" | python3 -c "import re,sys; text=sys.stdin.read(); matches=re.findall(r'0x[0-9a-fA-F]{64}', text); print(matches[-1] if matches else '')")
if [[ -z "$CRE_TX_HASH" ]]; then
  echo "Failed to extract CRE broadcast transaction hash" >&2
  exit 1
fi

RECEIPT_STATUS=$(cast receipt "$CRE_TX_HASH" --rpc-url "$RPC_URL" | awk '/status/ {print $2; exit}')
python3 - "$TMP_OUTPUT.claims" "$OWNER" "$OWNER_PK" "$TRADER_TWO" "$TRADER_TWO_PK" <<'PY' > "$TMP_OUTPUT.claim_calls"
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
  cast send "$MARKET_ADDRESS" 'claimEpochSettlement(uint64,uint64,(address,uint128,uint128,uint128,int128,int128),bytes32[])' \
    "$CLAIM_MARKET_ID" "$CLAIM_EPOCH" "$CLAIM_SETTLEMENT" "$CLAIM_PROOF" \
    --rpc-url "$RPC_URL" --private-key "$CLAIM_PK" >/dev/null
done < "$TMP_OUTPUT.claim_calls"

cast rpc --rpc-url "$RPC_URL" evm_setNextBlockTimestamp "$((END + 1))" >/dev/null
cast rpc --rpc-url "$RPC_URL" evm_mine >/dev/null
RESOLUTION_PERFORM_DATA=$(cast call "$MARKET_ADDRESS" 'checkUpkeep(bytes)(bool,bytes)' "$(cast abi-encode 'x(uint64[])' "[$MARKET_ID]")" --rpc-url "$RPC_URL" | tail -n 1)
RESOLUTION_REQUEST_OUTPUT=$(cast send "$MARKET_ADDRESS" 'performUpkeep(bytes)' "$RESOLUTION_PERFORM_DATA" --rpc-url "$RPC_URL" --private-key "$OWNER_PK" --json)
RESOLUTION_REQUEST_TX_HASH=$(printf '%s' "$RESOLUTION_REQUEST_OUTPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')

pushd "$CRE_DIR" >/dev/null
RESOLUTION_CRE_OUTPUT=$(CRE_ETH_PRIVATE_KEY="$OWNER_PK" cre workflow simulate ./private-market-resolution --project-root . --target local-simulation --non-interactive --trigger-index 0 --evm-tx-hash "$RESOLUTION_REQUEST_TX_HASH" --evm-event-index 0 --broadcast)
popd >/dev/null
printf '%s\n' "$RESOLUTION_CRE_OUTPUT"
RESOLUTION_CRE_TX_HASH=$(printf '%s\n' "$RESOLUTION_CRE_OUTPUT" | python3 -c "import re,sys; text=sys.stdin.read(); matches=re.findall(r'0x[0-9a-fA-F]{64}', text); print(matches[-1] if matches else '')")
if [[ -z "$RESOLUTION_CRE_TX_HASH" ]]; then
  echo "Failed to extract CRE resolution broadcast transaction hash" >&2
  exit 1
fi

RESOLUTION_RECEIPT_STATUS=$(cast receipt "$RESOLUTION_CRE_TX_HASH" --rpc-url "$RPC_URL" | awk '/status/ {print $2; exit}')
OWNER_POSITION=$(cast call "$MARKET_ADDRESS" 'positions(uint64,address)((uint128,uint128,bool))' "$MARKET_ID" "$OWNER" --rpc-url "$RPC_URL")
TRADER_TWO_POSITION=$(cast call "$MARKET_ADDRESS" 'positions(uint64,address)((uint128,uint128,bool))' "$MARKET_ID" "$TRADER_TWO" --rpc-url "$RPC_URL")
EPOCH_STATE=$(cast call "$MARKET_ADDRESS" 'epochStates(uint64,uint64)((bool,bool,uint96,bytes32,bytes32))' "$MARKET_ID" 1 --rpc-url "$RPC_URL")
RESOLUTION_STATE=$(cast call "$MARKET_ADDRESS" 'getMarketResolutionData(uint64)(string,uint64,uint8,uint8,bool)' "$MARKET_ID" --rpc-url "$RPC_URL")

python3 - "$RECEIPT_STATUS" "$RESOLUTION_RECEIPT_STATUS" "$OWNER_POSITION" "$TRADER_TWO_POSITION" "$EPOCH_STATE" "$RESOLUTION_STATE" "$MARKET_ADDRESS" "$CRE_TX_HASH" "$RESOLUTION_CRE_TX_HASH" <<'PY'
import re
import sys
receipt_status, resolution_receipt_status, owner_position, trader_two_position, epoch_state, resolution_state, market, tx_hash, resolution_tx_hash = sys.argv[1:10]
if receipt_status != '1':
    raise SystemExit(f'CRE broadcast transaction failed with status {receipt_status}')
if resolution_receipt_status != '1':
    raise SystemExit(f'CRE resolution transaction failed with status {resolution_receipt_status}')
nums_owner = [int(x) for x in re.findall(r'\d+', owner_position)]
nums_trader_two = [int(x) for x in re.findall(r'\d+', trader_two_position)]
epoch_parts = re.match(r'\((true|false),\s*(true|false),\s*(\d+)', epoch_state)
resolution_lines = [line.strip() for line in resolution_state.splitlines() if line.strip()]
if len(nums_owner) < 2 or nums_owner[0] == 0:
    raise SystemExit(f'Owner position did not gain YES shares: {owner_position}')
if len(nums_trader_two) < 2 or nums_trader_two[1] == 0:
    raise SystemExit(f'Second trader position did not gain NO shares: {trader_two_position}')
if epoch_parts is None or epoch_parts.group(1) != 'true' or epoch_parts.group(2) != 'true' or int(epoch_parts.group(3)) == 0:
    raise SystemExit(f'Epoch state not settled as expected: {epoch_state}')
if len(resolution_lines) < 4:
    raise SystemExit(f'Market resolution state not parseable: {resolution_state}')
resolution_status = resolution_lines[-3]
resolution_outcome = resolution_lines[-2]
resolution_requested = resolution_lines[-1].lower()
if resolution_status != '3' or resolution_outcome != '1' or resolution_requested != 'false':
    raise SystemExit(f'Market resolution state not updated as expected: {resolution_state}')
print(f'Market: {market}')
print(f'CRE broadcast tx: {tx_hash}')
print(f'CRE resolution tx: {resolution_tx_hash}')
print(f'Owner position: {owner_position}')
print(f'Second trader position: {trader_two_position}')
print(f'Epoch state: {epoch_state}')
print(f'Resolution state: {resolution_state}')
PY
