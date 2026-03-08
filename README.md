# Private Prediction Markets

This repository contains the initial Foundry-based smart contract implementation for a private prediction market designed for a Chainlink CRE hackathon.

## Current Scope

The first implementation pass focuses on the onchain protocol core:

- market creation
- internal collateral accounting
- encrypted order intake
- epoch-based settlement requests
- oracle-driven batch settlement
- internal position accounting
- market resolution and redemption
- Foundry tests for critical invariants

## Design Goals

- secure and gas-efficient smart contracts
- private order flow
- good UI and UX through explicit state and predictable events
- Chainlink CRE-compatible auction execution
- Chainlink Automation-compatible epoch triggering

## Contract Model

`PrivatePredictionMarket.sol` is the core protocol contract.

### Onchain responsibilities

- custody collateral
- maintain free and reserved collateral
- store encrypted order payloads
- expose epoch readiness for Automation
- emit settlement request events for CRE workflows
- accept oracle settlement reports
- track YES and NO positions internally
- resolve markets and allow redemption

### Offchain CRE responsibilities

A Chainlink CRE workflow should:

- listen for `EpochSettlementRequested`
- fetch encrypted orders for the relevant market and epoch
- decrypt and validate orders
- compute the batch auction clearing price
- aggregate per-trader settlement deltas
- submit `settleEpoch(...)` from the configured resolution oracle identity

### Automation responsibilities

The contract implements `checkUpkeep` and `performUpkeep`.

Recommended pattern:

- register upkeep against a bounded set of `marketId`s passed in `checkData`
- let `checkUpkeep` detect the next epoch that needs settlement
- let `performUpkeep` only mark that epoch as requested and emit `EpochSettlementRequested`

This keeps Automation gas usage low and makes `performUpkeep` idempotent-friendly.

## UI and UX Implications

The contract is designed so the frontend can provide a strong trading UX.

### UI-safe invariants

- deposits and withdrawals use internal free collateral
- traders lock collateral at the epoch level before submitting encrypted orders
- encrypted orders are accepted without revealing order contents onchain
- epoch transitions are explicit and event-driven
- post-trade positions are visible immediately after settlement
- redemptions are simple and deterministic after resolution

### Important frontend views

The UI should surface:

- free collateral
- reserved collateral
- current epoch
- epoch settlement pending state
- YES and NO positions per market
- resolution status and redeemable amount

## Security Posture

The current version follows these best-practice principles:

- explicit custom errors
- role-gated owner, oracle, and automation entry points
- no onchain matching logic
- checks-effects-interactions ordering on fund movements
- bounded Automation workload via caller-supplied market list
- separate free and reserved collateral accounting
- replay resistance through per-epoch settlement state

## Known MVP Tradeoffs

This is an MVP contract architecture suitable for hackathon iteration, not final production.

Current tradeoffs:

- settlement trusts the configured oracle for correctness
- no cryptographic proof of auction correctness yet
- per-trader settlement payloads may become expensive at large scale
- no cancellation flow for encrypted orders yet
- no partial multi-order collateral reconciliation beyond per-epoch net reservation

## Testing

Run tests with:

```bash
forge test
```

## Phase 1 Encrypted Order Setup

The current encrypted order flow uses client-side encryption plus epoch-level collateral locking.

### Encryption model

- frontend encrypts the order payload to the auction service public key
- frontend locks collateral with `lockEpochCollateral(...)` before submitting an order
- contract stores only opaque encrypted bytes in `submitEncryptedOrder(...)`
- auction service decrypts the payload when processing epoch settlement
- onchain observers can see epoch-level collateral locks, but no longer see per-order collateral amounts

### Required environment variables

#### Frontend

Set the auction service public key in your frontend environment:

```bash
NEXT_PUBLIC_AUCTION_SERVICE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

#### Auction service

Set the matching private key in `cre/.env` or your process environment:

```bash
AUCTION_SERVICE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

### Generate a demo RSA keypair

You can generate a compatible RSA-OAEP keypair with:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out auction_private_key.pem
openssl rsa -pubout -in auction_private_key.pem -out auction_public_key.pem
```

Then:

- copy `auction_private_key.pem` into `AUCTION_SERVICE_PRIVATE_KEY`
- copy `auction_public_key.pem` into `NEXT_PUBLIC_AUCTION_SERVICE_PUBLIC_KEY`

If you need to place the public key into a single-line `.env` value, escape the newlines:

```bash
python3 - <<'PY'
from pathlib import Path
print(Path('auction_public_key.pem').read_text().replace('\n', '\\n'))
PY
```

### Backward compatibility

The auction service still accepts the previous plaintext JSON payload format so existing local fixtures and already-submitted demo orders continue to work during migration.

Current suite covers:

- deposit and withdrawal
- epoch collateral locking and unlocking
- encrypted order submission with locked epoch collateral
- Automation-triggered epoch settlement request
- oracle settlement updates
- redemption after market resolution

## Recommended Next Steps

### Contract

- split the monolith into market, ledger, order, and settlement modules
- add pausing and emergency controls
- add stronger oracle report verification
- add fuzz and invariant tests
- add settlement compression strategy for scale

### CRE workflow

- implement a trigger-and-callback workflow for `EpochSettlementRequested`
- fetch onchain order data and decrypt offchain
- aggregate settlements into net deltas
- submit settlement with a dedicated oracle key or signer flow

### Frontend

- build an order composer that encrypts client-side
- show epoch-level locked collateral before and after order submission
- display epoch countdown and settlement progress
- provide a portfolio view for YES/NO positions and redeemable payout
