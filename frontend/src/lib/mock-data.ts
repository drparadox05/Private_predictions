import type { Market, PortfolioHistoryItem, PortfolioPosition } from "@/lib/types";

export const protocolStats = [
  { label: "Encrypted TVL", value: 2480000, suffix: "" },
  { label: "Active Markets", value: 24, suffix: "" },
  { label: "Shielded Traders", value: 12840, suffix: "" }
];

export const technologyCards = [
  {
    title: "Chainlink Automation",
    description: "Epoch transitions and market resolution requests stay deterministic and gas-bounded."
  },
  {
    title: "Chainlink CRE",
    description: "Offchain workflows decrypt, settle, and finalize private order flow with verifiable reports."
  },
  {
    title: "Client-side Encryption",
    description: "Orders are intended to be encrypted before transport so the mempool never reveals trading intent."
  },
  {
    title: "Merkle Claims",
    description: "Settlement roots support scalable pull-based claiming without exposing full trader history."
  }
] as const;

export const markets: Market[] = [
  {
    id: 1,
    slug: "btc-120k-q2",
    question: "Will BTC settle above $120k by the end of Q2 2026?",
    category: "Crypto",
    description: "A private order flow market tracking whether BTC closes the quarter above the threshold.",
    expiry: "2026-06-30T23:59:59.000Z",
    resolutionSource: "Chainlink price feeds + CRE resolution workflow",
    liquidity: 780000,
    volume: 2160000,
    traders: 1832,
    yesProbability: 63,
    encryptedOrders: 142,
    status: "Live",
    tags: ["BTC", "Quarterly", "High liquidity"],
    chart: [
      { time: "00:00", yes: 48, no: 52, volume: 120000 },
      { time: "04:00", yes: 51, no: 49, volume: 142000 },
      { time: "08:00", yes: 56, no: 44, volume: 188000 },
      { time: "12:00", yes: 59, no: 41, volume: 236000 },
      { time: "16:00", yes: 61, no: 39, volume: 252000 },
      { time: "20:00", yes: 63, no: 37, volume: 264000 }
    ],
    timeline: [
      { label: "Market created", description: "Owner initialized the market and funding rails.", state: "completed" },
      { label: "Encrypted trading", description: "Orders are being submitted while collateral is locked and settled at the epoch level.", state: "active" },
      { label: "Epoch settlement", description: "CRE workflow will process encrypted order batches once epochs end.", state: "upcoming" },
      { label: "Resolution + claims", description: "Winning traders claim from the finalized settlement root.", state: "upcoming" }
    ]
  },
  {
    id: 2,
    slug: "eth-etf-volume",
    question: "Will spot ETH ETF net inflows exceed $3B this month?",
    category: "Crypto",
    description: "Macro-crypto market with private order entry and batched auction clearing.",
    expiry: "2026-04-30T23:59:59.000Z",
    resolutionSource: "Chainlink Functions + trusted data providers",
    liquidity: 540000,
    volume: 1380000,
    traders: 964,
    yesProbability: 41,
    encryptedOrders: 97,
    status: "Live",
    tags: ["ETH", "ETF", "Monthly"],
    chart: [
      { time: "00:00", yes: 44, no: 56, volume: 86000 },
      { time: "04:00", yes: 42, no: 58, volume: 97000 },
      { time: "08:00", yes: 39, no: 61, volume: 113000 },
      { time: "12:00", yes: 40, no: 60, volume: 128000 },
      { time: "16:00", yes: 41, no: 59, volume: 141000 },
      { time: "20:00", yes: 41, no: 59, volume: 152000 }
    ],
    timeline: [
      { label: "Market created", description: "Resolution rails and trading windows configured.", state: "completed" },
      { label: "Encrypted trading", description: "Open with active encrypted order flow.", state: "active" },
      { label: "Settlement pending", description: "Awaiting the next completed epoch for batch settlement.", state: "upcoming" },
      { label: "Resolution + claims", description: "Payouts unlock after oracle-backed resolution.", state: "upcoming" }
    ]
  },
  {
    id: 3,
    slug: "champions-final",
    question: "Will the underdog win the Champions Final?",
    category: "Sports",
    description: "Short-duration sports event with hidden pre-match and in-play interest snapshots.",
    expiry: "2026-05-18T18:00:00.000Z",
    resolutionSource: "Chainlink oracle + official league feed",
    liquidity: 320000,
    volume: 910000,
    traders: 622,
    yesProbability: 29,
    encryptedOrders: 58,
    status: "Settling",
    tags: ["Sports", "Event", "Settling"],
    chart: [
      { time: "00:00", yes: 34, no: 66, volume: 54000 },
      { time: "04:00", yes: 33, no: 67, volume: 64000 },
      { time: "08:00", yes: 31, no: 69, volume: 72000 },
      { time: "12:00", yes: 30, no: 70, volume: 78000 },
      { time: "16:00", yes: 29, no: 71, volume: 81000 },
      { time: "20:00", yes: 29, no: 71, volume: 81000 }
    ],
    timeline: [
      { label: "Market created", description: "Opening auction published.", state: "completed" },
      { label: "Encrypted trading", description: "Trading window has closed.", state: "completed" },
      { label: "Epoch settlement", description: "CRE workflow is finalizing the settlement root.", state: "active" },
      { label: "Resolution + claims", description: "Claims unlock once the oracle confirms the match outcome.", state: "upcoming" }
    ]
  },
  {
    id: 4,
    slug: "fed-rate-cut",
    question: "Will the Fed cut rates before September 2026?",
    category: "Macro",
    description: "Long-dated macro market designed for staged private order batching and oracle resolution.",
    expiry: "2026-09-30T23:59:59.000Z",
    resolutionSource: "Chainlink Functions + FOMC statement verification",
    liquidity: 960000,
    volume: 3070000,
    traders: 2140,
    yesProbability: 57,
    encryptedOrders: 166,
    status: "Live",
    tags: ["Macro", "Rates", "High conviction"],
    chart: [
      { time: "00:00", yes: 52, no: 48, volume: 134000 },
      { time: "04:00", yes: 53, no: 47, volume: 148000 },
      { time: "08:00", yes: 55, no: 45, volume: 159000 },
      { time: "12:00", yes: 56, no: 44, volume: 181000 },
      { time: "16:00", yes: 57, no: 43, volume: 198000 },
      { time: "20:00", yes: 57, no: 43, volume: 211000 }
    ],
    timeline: [
      { label: "Market created", description: "Governance-defined market terms deployed onchain.", state: "completed" },
      { label: "Encrypted trading", description: "Open for protected participation.", state: "active" },
      { label: "Epoch settlement", description: "Auction engine settles each epoch after it closes.", state: "upcoming" },
      { label: "Resolution + claims", description: "Final outcome settles through oracle-backed evidence.", state: "upcoming" }
    ]
  }
];

export const portfolioPositions: PortfolioPosition[] = [
  {
    id: "pos-1",
    marketId: 1,
    marketQuestion: markets[0].question,
    side: "Yes",
    amount: 2400,
    avgPrice: 0.58,
    status: "Active",
    pnl: 312,
    expiry: markets[0].expiry
  },
  {
    id: "pos-2",
    marketId: 3,
    marketQuestion: markets[2].question,
    side: "No",
    amount: 1250,
    avgPrice: 0.71,
    status: "Awaiting Claim",
    pnl: 184,
    expiry: markets[2].expiry
  },
  {
    id: "pos-3",
    marketId: 4,
    marketQuestion: markets[3].question,
    side: "Yes",
    amount: 3200,
    avgPrice: 0.54,
    status: "Active",
    pnl: -96,
    expiry: markets[3].expiry
  }
];

export const portfolioHistory: PortfolioHistoryItem[] = [
  {
    id: "hist-1",
    marketQuestion: "Will SOL hold above $300 at month-end?",
    outcome: "Yes",
    stake: 1400,
    payout: 1960,
    pnl: 560,
    resolvedAt: "2026-02-28T17:30:00.000Z"
  },
  {
    id: "hist-2",
    marketQuestion: "Will a major L2 exceed 10M daily transactions this quarter?",
    outcome: "No",
    stake: 900,
    payout: 0,
    pnl: -900,
    resolvedAt: "2026-01-12T12:00:00.000Z"
  }
];

export function getMarketById(id: number) {
  return markets.find((market) => market.id === id);
}
