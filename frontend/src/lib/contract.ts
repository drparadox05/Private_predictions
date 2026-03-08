import type { Address } from "viem";

export const deployment = {
  chainName: "Ethereum Sepolia",
  chainId: 11155111,
  marketAddress: (process.env.NEXT_PUBLIC_MARKET_ADDRESS ?? "0x341aF4ED4A95b556cc9B7B429cc84EbaD8FF3d62") as Address,
  usdcAddress: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x724fb30A71fB0bB4Cb03383686A5DB37C75E5A29") as Address,
  auctionServiceUrl: process.env.NEXT_PUBLIC_AUCTION_SERVICE_URL ?? "http://127.0.0.1:8080/settle-epoch",
  resolutionServiceUrl: process.env.NEXT_PUBLIC_RESOLUTION_SERVICE_URL ?? "http://127.0.0.1:18081/resolve-market",
  auctionServicePublicKey: process.env.NEXT_PUBLIC_AUCTION_SERVICE_PUBLIC_KEY ?? ""
} as const;

export const marketAbi = [
  {
    type: "error",
    name: "Unauthorized",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidAddress",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidMarket",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidEpoch",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidState",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidArrayLength",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidSettlement",
    inputs: []
  },
  {
    type: "error",
    name: "Reentrancy",
    inputs: []
  },
  {
    type: "error",
    name: "InsufficientFreeCollateral",
    inputs: []
  },
  {
    type: "error",
    name: "InsufficientReservedCollateral",
    inputs: []
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: []
  },
  {
    type: "error",
    name: "EpochNotReady",
    inputs: []
  },
  {
    type: "error",
    name: "EpochAlreadySettled",
    inputs: []
  },
  {
    type: "error",
    name: "MarketClosed",
    inputs: []
  },
  {
    type: "error",
    name: "MarketNotResolved",
    inputs: []
  },
  {
    type: "error",
    name: "NothingToRedeem",
    inputs: []
  },
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "question", type: "string" },
      { name: "resolutionOracle", type: "address" },
      { name: "tradingStart", type: "uint64" },
      { name: "tradingEnd", type: "uint64" },
      { name: "epochLength", type: "uint64" }
    ],
    outputs: [{ name: "marketId", type: "uint64" }]
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "nextMarketId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }]
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "lockEpochCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "amount", type: "uint128" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "unlockEpochCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "amount", type: "uint128" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "submitEncryptedOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "ciphertext", type: "bytes" }
    ],
    outputs: [{ name: "orderId", type: "uint256" }]
  },
  {
    type: "function",
    name: "freeCollateral",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "reservedCollateral",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint64" }],
    outputs: [
      { name: "resolutionOracle", type: "address" },
      { name: "tradingStart", type: "uint64" },
      { name: "tradingEnd", type: "uint64" },
      { name: "epochLength", type: "uint64" },
      { name: "lastEpochSettlementRequest", type: "uint64" },
      { name: "lastSettledEpoch", type: "uint64" },
      { name: "orderCount", type: "uint32" },
      { name: "status", type: "uint8" },
      { name: "resolvedOutcome", type: "uint8" },
      { name: "question", type: "string" }
    ]
  },
  {
    type: "function",
    name: "getMarketResolutionData",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint64" }],
    outputs: [
      { name: "question", type: "string" },
      { name: "tradingEnd", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "resolvedOutcome", type: "uint8" },
      { name: "resolutionRequested", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "getMarketShareSupply",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint64" }],
    outputs: [
      { name: "claimedYesShares", type: "int256" },
      { name: "claimedNoShares", type: "int256" },
      { name: "pendingYesSharesDelta", type: "int256" },
      { name: "pendingNoSharesDelta", type: "int256" }
    ]
  },
  {
    type: "function",
    name: "getClaimQueueState",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "user", type: "address" }
    ],
    outputs: [
      { name: "nextEpoch", type: "uint64" },
      { name: "pendingCount", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "getPendingClaimEpochs",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "user", type: "address" },
      { name: "maxCount", type: "uint256" }
    ],
    outputs: [{ name: "epochs", type: "uint64[]" }]
  },
  {
    type: "function",
    name: "getClaimStatus",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "user", type: "address" }
    ],
    outputs: [
      { name: "queued", type: "bool" },
      { name: "readyToClaim", type: "bool" },
      { name: "claimed", type: "bool" },
      { name: "reservedForEpoch", type: "uint256" },
      { name: "clearingPrice", type: "uint96" },
      { name: "settlementRoot", type: "bytes32" }
    ]
  },
  {
    type: "function",
    name: "getUserMarketState",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "user", type: "address" }
    ],
    outputs: [
      { name: "freeBalance", type: "uint256" },
      { name: "reservedBalance", type: "uint256" },
      { name: "yesShares", type: "uint128" },
      { name: "noShares", type: "uint128" },
      { name: "redeemed", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "getNextSettlementEpoch",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint64" }],
    outputs: [{ name: "", type: "uint64" }]
  },
  {
    type: "function",
    name: "getCurrentEpoch",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint64" }],
    outputs: [{ name: "", type: "uint64" }]
  },
  {
    type: "function",
    name: "getEpochOrderCount",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "getEpochOrderIds",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "epochReservedCollateral",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "trader", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "orders",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "trader", type: "address" },
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "submittedAt", type: "uint40" },
      { name: "ciphertext", type: "bytes" }
    ]
  },
  {
    type: "function",
    name: "claimEpochSettlement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint64" },
      { name: "epoch", type: "uint64" },
      {
        name: "traderSettlement",
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "reservedCollateralSpent", type: "uint128" },
          { name: "reservedCollateralRefunded", type: "uint128" },
          { name: "collateralCredit", type: "uint128" },
          { name: "yesSharesDelta", type: "int128" },
          { name: "noSharesDelta", type: "int128" }
        ]
      },
      { name: "merkleProof", type: "bytes32[]" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint64" }],
    outputs: []
  },
  {
    type: "event",
    name: "MarketCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint64" },
      { indexed: true, name: "resolutionOracle", type: "address" },
      { indexed: false, name: "tradingStart", type: "uint64" },
      { indexed: false, name: "tradingEnd", type: "uint64" },
      { indexed: false, name: "epochLength", type: "uint64" },
      { indexed: false, name: "question", type: "string" }
    ]
  },
  {
    type: "event",
    name: "Redeemed",
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "uint64" },
      { indexed: false, name: "payout", type: "uint256" }
    ]
  }
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
] as const;
