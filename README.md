# ShadowMarket

ShadowMarket is a privacy-preserving prediction market built for the **Chainlink CRE Hackathon**.

The design goal is to prevent order intent from leaking before execution. In most onchain markets, visible order flow creates front-running, copy-trading, and worse price formation. ShadowMarket applies the private-order-flow thesis popularized by firms like Paradigm to prediction markets: **users should be able to express views without revealing them before clearing**.

## System overview

- traders deposit collateral onchain
- traders submit encrypted orders instead of plaintext orders
- orders are grouped into epochs
- Chainlink Automation requests the next settlement or resolution action
- Chainlink CRE workflows perform offchain settlement and resolution
- the contract finalizes state onchain and traders claim results

## Architecture

```text
                                    +---------------------------+
                                    |   Chainlink Automation    |
                                    | checkUpkeep/performUpkeep |
                                    +-------------+-------------+
                                                  |
                                                  v
+------------------+      encrypted orders   +----+-----------------------------------+
|      Trader      | ----------------------> |      PrivatePredictionMarket.sol        |
|  frontend / UI   |                         |-----------------------------------------|
| deposit + sign   | <---------------------- | collateral, epochs, positions, claims   |
+------------------+      balances/state     | emits settlement/resolution requests    |
                                            +----+-------------------+-----------------+
                                                 |                   |
                           EpochSettlementRequested               MarketResolutionRequested
                                                 |                   |
                                                 v                   v
                                   +-------------+----+     +--------+--------------+
                                   | CRE settlement  |     | CRE resolution        |
                                   | workflow        |     | workflow              |
                                   +-------------+----+     +--------+--------------+
                                                 |                   |
                                                 v                   v
                                   +-------------+----+     +--------+--------------+
                                   | Auction service |     | Resolution service     |
                                   | decrypt + match |     | outcome + evidence     |
                                   +-------------+----+     +--------+--------------+
                                                 |                   |
                                                 +---------+---------+
                                                           |
                                                           v
                                              CRE report delivered onchain
```

## Flow

### 1. Order entry

- trader deposits collateral
- trader locks epoch collateral
- frontend encrypts order payload to the auction service public key
- `submitEncryptedOrder(...)` stores ciphertext onchain

### 2. Epoch settlement

- Automation triggers `performUpkeep(...)` when an epoch is ready
- contract emits `EpochSettlementRequested(marketId, epoch)`
- CRE settlement workflow reads order ids, orders, and reserved collateral
- auction service decrypts orders, computes the clearing price, and returns:
  - `clearingPrice`
  - `settlementHash`
  - `settlementRoot`
  - aggregate YES / NO share deltas
- CRE delivers the settlement report onchain
- traders claim epoch settlement with `claimEpochSettlement(...)` using Merkle proofs

### 3. Market resolution

- after trading ends, Automation requests resolution
- contract emits `MarketResolutionRequested(marketId)`
- CRE resolution workflow reads market metadata, fetches offchain resolution context through the resolution service, and packages the result for onchain delivery
- CRE delivers the resolution report onchain with outcome and evidence hash
- users redeem after all required settlement claims are completed

## Chainlink integration

### Chainlink Automation

- used for lightweight triggering only
- detects when an epoch is ready for settlement
- detects when a market is ready for final resolution
- avoids putting expensive settlement logic directly in upkeep execution

### Chainlink CRE

- settlement workflow: `cre/private-market-settlement/main.ts`
- resolution workflow: `cre/private-market-resolution/main.ts`
- both workflows listen to contract events, fetch offchain context, and write reports back onchain
- in particular, market resolution is intentionally handled as an offchain data-fetch + report-delivery workflow rather than a hardcoded onchain oracle answer

This is the core architectural split in ShadowMarket:

- **onchain**: custody, invariants, accounting, settlement finalization, redemption
- **offchain via CRE**: private order handling, matching, external resolution logic

## Why resolution infrastructure matters

Prediction markets do not only fail on execution quality; they also fail when users lose confidence in how outcomes are resolved. Recent, widely reported controversies around oracle-driven market resolution on platforms such as Polymarket have highlighted how disputed resolution paths and governance-heavy oracle processes can damage trust in the market itself.

ShadowMarket treats resolution as first-class infrastructure:

- Chainlink CRE fetches offchain data needed for resolution through a dedicated workflow
- the workflow packages both the resolved outcome and an evidence hash for onchain finalization
- Chainlink's broader privacy and confidential-compute stack is designed to support stronger execution integrity and privacy properties, including TEE-based confidential computation in the Chainlink Privacy Standard

In practice, this means ShadowMarket is designed around the idea that **market resolution must be both externally informed and operationally trustworthy**.

## Main components

- **Contract**: `src/PrivatePredictionMarket.sol`
- **Settlement workflow**: `cre/private-market-settlement/main.ts`
- **Resolution workflow**: `cre/private-market-resolution/main.ts`
- **Auction service**: `cre/auction-service/server.mjs`
- **Resolution service**: `cre/resolution-service/server.mjs`
- **Frontend**: `frontend/`
- **Sepolia E2E demo**: `scripts/run_sepolia_cre_e2e.sh`
- **Operator loop**: `scripts/run_sepolia_operator.sh`

## Deployed onchain

- **Network**: Sepolia
- **ShadowMarket contract**: [`0x341aF4ED4A95b556cc9B7B429cc84EbaD8FF3d62`](https://sepolia.etherscan.io/address/0x341aF4ED4A95b556cc9B7B429cc84EbaD8FF3d62)
- **Mock USDC**: [`0x724fb30A71fB0bB4Cb03383686A5DB37C75E5A29`](https://sepolia.etherscan.io/address/0x724fb30A71fB0bB4Cb03383686A5DB37C75E5A29)
- **Deployment manifest**: `deployments/sepolia.latest.json`


## Repository layout

- **`src/`**: Solidity contracts
- **`test/`**: Foundry tests
- **`cre/`**: Chainlink CRE workflows and supporting services
- **`frontend/`**: Next.js application
- **`scripts/`**: deployment, operator, and demo scripts
- **`deployments/`**: deployment manifests
