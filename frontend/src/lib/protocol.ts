import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import { sepolia } from "wagmi/chains";

import { deployment, marketAbi } from "@/lib/contract";
import { getMarketById, markets as mockMarkets } from "@/lib/mock-data";
import type { Market, MarketCategory, MarketStatus, PortfolioPosition, PositionSide, TimelineItem } from "@/lib/types";

const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
const hasLiveRpc = Boolean(sepoliaRpcUrl);

const protocolClient = createPublicClient({
  chain: sepolia,
  transport: http(sepoliaRpcUrl)
});

export interface ProtocolMarket extends Market {
  resolutionOracle: Address;
  tradingStart: string;
  epochLength: number;
  lastSettledEpoch: number;
  lastEpochSettlementRequest: number;
  resolutionRequested: boolean;
  resolvedOutcomeLabel: "Undetermined" | "Yes" | "No";
  onchainOrderCount: number;
  onchainStatusCode: number;
  claimedYesShares: bigint;
  claimedNoShares: bigint;
  pendingYesSharesDelta: bigint;
  pendingNoSharesDelta: bigint;
  isIndexedFallback: boolean;
}

const fallbackProtocolMarkets = mockMarkets.map((market) => toFallbackProtocolMarket(market));

export interface ProtocolPosition extends PortfolioPosition {
  slug: string;
  shares: number;
  pendingClaimCount: number;
  redeemed: boolean;
  redeemable: boolean;
}

export interface RedemptionRecord {
  id: string;
  marketId: number;
  marketQuestion: string;
  slug: string;
  outcome: "Yes" | "No" | "Undetermined";
  payout: number;
  resolvedAt: string;
}

export interface PortfolioSnapshot {
  positions: ProtocolPosition[];
  history: RedemptionRecord[];
  totals: {
    activeExposure: number;
    awaitingClaims: number;
    realizedPayouts: number;
  };
  redeemableMarketIds: number[];
}

export interface ServiceStatusItem {
  ok: boolean;
  label: string;
  url: string;
  error?: string;
}

export interface ServiceStatusResponse {
  auction: ServiceStatusItem;
  resolution: ServiceStatusItem;
  checkedAt: string;
}

export interface ReadyClaimSettlement {
  trader: Address;
  reservedCollateralSpent: string;
  reservedCollateralRefunded: string;
  collateralCredit: string;
  yesSharesDelta: string;
  noSharesDelta: string;
}

export interface ReadyClaim {
  marketId: string;
  epoch: string;
  clearingPrice: string;
  settlementRoot: `0x${string}`;
  settlement: ReadyClaimSettlement;
  merkleProof: `0x${string}`[];
}

export interface ReadyClaimsResponse {
  address: Address;
  claims: ReadyClaim[];
}

type RedeemedEventArgs = {
  marketId?: bigint;
  payout?: bigint;
};

export function useProtocolMarkets() {
  return useQuery({
    queryKey: ["protocol-markets"],
    queryFn: fetchProtocolMarkets,
    staleTime: 120_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 0
  });
}

export function useProtocolMarket(slug: string) {
  const marketsQuery = useProtocolMarkets();
  const market = marketsQuery.data ? resolveMarketBySlug(marketsQuery.data, slug) : undefined;

  return {
    ...marketsQuery,
    data: market
  };
}

export function usePortfolioSnapshot(address?: Address) {
  const marketsQuery = useProtocolMarkets();

  return useQuery({
    queryKey: ["portfolio-snapshot", address, marketsQuery.data?.map((market) => market.id).join(",")],
    enabled: Boolean(address) && Boolean(marketsQuery.data?.length),
    queryFn: async () => fetchPortfolioSnapshot(address as Address, marketsQuery.data ?? []),
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 0
  });
}

export function useServiceStatus() {
  return useQuery({
    queryKey: ["service-status"],
    queryFn: fetchServiceStatus,
    staleTime: 120_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 0
  });
}

export function useReadyClaims(address?: Address, marketId?: number) {
  return useQuery({
    queryKey: ["ready-claims", address, marketId],
    enabled: Boolean(address),
    queryFn: async () => fetchReadyClaims(address as Address, marketId),
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 0
  });
}

async function fetchProtocolMarkets(): Promise<ProtocolMarket[]> {
  if (!hasLiveRpc) {
    return fallbackProtocolMarkets;
  }

  try {
    const marketIds = await enumerateMarketIds();

    if (marketIds.length === 0) {
      return fallbackProtocolMarkets;
    }

    const contracts = marketIds.flatMap((marketId) => {
      return [
        {
          address: deployment.marketAddress,
          abi: marketAbi,
          functionName: "markets",
          args: [marketId]
        },
        {
          address: deployment.marketAddress,
          abi: marketAbi,
          functionName: "getMarketResolutionData",
          args: [marketId]
        },
        {
          address: deployment.marketAddress,
          abi: marketAbi,
          functionName: "getMarketShareSupply",
          args: [marketId]
        }
      ] as const;
    });

    const results = await protocolClient.multicall({
      contracts,
      allowFailure: true
    });

    const liveMarkets = marketIds.flatMap((marketId, index) => {
      const numericMarketId = Number(marketId);
      const fallback = getMarketById(numericMarketId);
      const marketResult = results[index * 3];
      const resolutionResult = results[index * 3 + 1];
      const shareResult = results[index * 3 + 2];

      if (marketResult.status !== "success" && resolutionResult.status !== "success") {
        return [];
      }

      const marketStruct = marketResult.status === "success" ? marketResult.result : undefined;
      const resolutionData = resolutionResult.status === "success" ? resolutionResult.result : undefined;
      const shareSupply = shareResult.status === "success" ? shareResult.result : undefined;

      const resolutionOracle = (marketStruct?.[0] ?? deployment.marketAddress) as Address;
      const tradingStart = Number(marketStruct?.[1] ?? 0n);
      const tradingEnd = Number(marketStruct?.[2] ?? 0n);
      const epochLength = Number(marketStruct?.[3] ?? 0n);
      const lastEpochSettlementRequest = Number(marketStruct?.[4] ?? 0n);
      const lastSettledEpoch = Number(marketStruct?.[5] ?? 0n);
      const orderCount = Number(marketStruct?.[6] ?? 0);
      const statusCode = Number(marketStruct?.[7] ?? resolutionData?.[2] ?? 0);
      const resolvedOutcome = Number(marketStruct?.[8] ?? resolutionData?.[3] ?? 0);
      const question = String(resolutionData?.[0] ?? marketStruct?.[9] ?? fallback?.question ?? `Market ${numericMarketId}`);
      const resolutionRequested = Boolean(resolutionData?.[4] ?? false);
      const claimedYesShares = BigInt(shareSupply?.[0] ?? 0n);
      const claimedNoShares = BigInt(shareSupply?.[1] ?? 0n);
      const pendingYesSharesDelta = BigInt(shareSupply?.[2] ?? 0n);
      const pendingNoSharesDelta = BigInt(shareSupply?.[3] ?? 0n);
      const status = deriveDisplayStatus(statusCode, tradingEnd, resolutionRequested);
      const yesProbability = deriveYesProbability({
        claimedYesShares,
        claimedNoShares,
        pendingYesSharesDelta,
        pendingNoSharesDelta,
        fallback: fallback?.yesProbability ?? 50
      });
      const fallbackSlug = fallback?.slug;
      const slug = fallbackSlug ?? buildProtocolSlug(numericMarketId, question);
      const syntheticMetric = Math.max(orderCount, 1) * 2_500;
      const derivedChartVolume = fallback?.chart?.reduce((total, point) => total + point.volume, 0) ?? 0;
      const displayedVolume = fallback?.volume ?? (derivedChartVolume > 0 ? derivedChartVolume : syntheticMetric * 2);

      return {
        id: numericMarketId,
        slug,
        question,
        category: fallback?.category ?? inferCategory(question),
        description: fallback?.description ?? `Onchain market ${numericMarketId} sourced from the deployed prediction market contract on ${deployment.chainName}.`,
        expiry: toIsoTimestamp(tradingEnd),
        resolutionSource: fallback?.resolutionSource ?? formatResolutionSource(resolutionOracle),
        liquidity: fallback?.liquidity ?? syntheticMetric,
        volume: displayedVolume,
        traders: fallback?.traders ?? Math.max(orderCount, 1),
        yesProbability,
        encryptedOrders: orderCount,
        status,
        chart: fallback?.chart ?? buildSyntheticChart(yesProbability, Math.max(orderCount, 1)),
        timeline: fallback?.timeline ?? buildTimeline(status, resolutionRequested),
        tags: fallback?.tags ?? buildTags(question, status),
        resolutionOracle,
        tradingStart: toIsoTimestamp(tradingStart),
        epochLength,
        lastSettledEpoch,
        lastEpochSettlementRequest,
        resolutionRequested,
        resolvedOutcomeLabel: mapOutcomeLabel(resolvedOutcome),
        onchainOrderCount: orderCount,
        onchainStatusCode: statusCode,
        claimedYesShares,
        claimedNoShares,
        pendingYesSharesDelta,
        pendingNoSharesDelta,
        isIndexedFallback: false
      } satisfies ProtocolMarket;
    });

    return liveMarkets.length > 0 ? liveMarkets : fallbackProtocolMarkets;
  } catch {
    return fallbackProtocolMarkets;
  }
}

async function fetchPortfolioSnapshot(address: Address, markets: ProtocolMarket[]): Promise<PortfolioSnapshot> {
  if (!hasLiveRpc) {
    return {
      positions: [],
      history: [],
      totals: {
        activeExposure: 0,
        awaitingClaims: 0,
        realizedPayouts: 0
      },
      redeemableMarketIds: []
    };
  }

  const contracts = markets.flatMap((market) => [
    {
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "getUserMarketState",
      args: [BigInt(market.id), address]
    },
    {
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "getClaimQueueState",
      args: [BigInt(market.id), address]
    }
  ] as const);

  const results = await protocolClient.multicall({
    contracts,
    allowFailure: true
  });

  const positions: ProtocolPosition[] = [];
  let history: RedemptionRecord[] = [];
  const redeemedMarketIds = new Set<number>();

  for (let index = 0; index < markets.length; index += 1) {
    const market = markets[index];
    const userStateResult = results[index * 2];
    const claimStateResult = results[index * 2 + 1];

    if (userStateResult.status !== "success" || claimStateResult.status !== "success") {
      continue;
    }

    const userState = userStateResult.result;
    const claimState = claimStateResult.result;
    const yesShares = BigInt(userState[2] ?? 0n);
    const noShares = BigInt(userState[3] ?? 0n);
    const redeemed = Boolean(userState[4] ?? false);
    const pendingClaimCount = Number(claimState[1] ?? 0n);

    if (redeemed) {
      redeemedMarketIds.add(market.id);
    }

    const derivedPositions = [
      createProtocolPosition(market, "Yes", yesShares, pendingClaimCount, redeemed),
      createProtocolPosition(market, "No", noShares, pendingClaimCount, redeemed)
    ].filter((position): position is ProtocolPosition => Boolean(position));

    positions.push(...derivedPositions);
  }

  if (positions.length === 0 && redeemedMarketIds.size === 0) {
    return {
      positions,
      history,
      totals: {
        activeExposure: 0,
        awaitingClaims: 0,
        realizedPayouts: 0
      },
      redeemableMarketIds: []
    };
  }

  if (redeemedMarketIds.size > 0) {
    try {
      const redemptionLogs = await protocolClient.getContractEvents({
        address: deployment.marketAddress,
        abi: marketAbi,
        eventName: "Redeemed",
        args: { user: address },
        fromBlock: 0n,
        strict: false
      });

      const uniqueBlockNumbers = [...new Set(redemptionLogs.map((log) => log.blockNumber).filter((blockNumber): blockNumber is bigint => Boolean(blockNumber)))];
      const blocks = await Promise.all(uniqueBlockNumbers.map((blockNumber) => protocolClient.getBlock({ blockNumber })));
      const blockMap = new Map(uniqueBlockNumbers.map((blockNumber, index) => [blockNumber.toString(), blocks[index]]));

      history = redemptionLogs
        .slice()
        .reverse()
        .map((log, index) => {
          const logArgs = getRedeemedArgs(log);
          const marketId = Number(logArgs.marketId ?? 0n);
          const market = markets.find((entry) => entry.id === marketId);
          const block = log.blockNumber ? blockMap.get(log.blockNumber.toString()) : undefined;

          return {
            id: `${log.transactionHash ?? "redeem"}-${index}`,
            marketId,
            marketQuestion: market?.question ?? `Market ${marketId}`,
            slug: market?.slug ?? buildProtocolSlug(marketId, market?.question ?? `Market ${marketId}`),
            outcome: market?.resolvedOutcomeLabel ?? "Undetermined",
            payout: microToNumber(BigInt(logArgs.payout ?? 0n)),
            resolvedAt: toIsoTimestamp(Number(block?.timestamp ?? 0n))
          } satisfies RedemptionRecord;
        });
    } catch {
      history = [];
    }
  }

  return {
    positions,
    history,
    totals: {
      activeExposure: positions.filter((position) => position.status === "Active").reduce((total, position) => total + position.amount, 0),
      awaitingClaims: positions.filter((position) => position.status === "Awaiting Claim").reduce((total, position) => total + position.amount, 0),
      realizedPayouts: history.reduce((total, item) => total + item.payout, 0)
    },
    redeemableMarketIds: positions.filter((position) => position.redeemable).map((position) => position.marketId)
  };
}

async function fetchServiceStatus(): Promise<ServiceStatusResponse> {
  if (typeof window === "undefined") {
    return {
      auction: {
        ok: false,
        label: "Auction service",
        url: deployment.auctionServiceUrl,
        error: "Service checks are only available in the browser runtime."
      },
      resolution: {
        ok: false,
        label: "Resolution service",
        url: deployment.resolutionServiceUrl,
        error: "Service checks are only available in the browser runtime."
      },
      checkedAt: new Date().toISOString()
    };
  }

  const response = await fetch("/api/services/status", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Service status request failed with ${response.status}`);
  }

  return response.json() as Promise<ServiceStatusResponse>;
}

async function fetchReadyClaims(address: Address, marketId?: number): Promise<ReadyClaimsResponse> {
  if (!hasLiveRpc || typeof window === "undefined") {
    return {
      address,
      claims: []
    };
  }

  const params = new URLSearchParams({ address });
  if (marketId !== undefined) {
    params.set("marketId", String(marketId));
  }

  const response = await fetch(`/api/claims/ready?${params.toString()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Ready claims request failed with ${response.status}`);
  }

  return response.json() as Promise<ReadyClaimsResponse>;
}

function getRedeemedArgs(log: unknown): RedeemedEventArgs {
  return ((log as { args?: RedeemedEventArgs }).args ?? {}) as RedeemedEventArgs;
}

async function enumerateMarketIds() {
  const nextMarketId = await protocolClient.readContract({
    address: deployment.marketAddress,
    abi: marketAbi,
    functionName: "nextMarketId"
  });

  return Array.from({ length: Math.max(Number(nextMarketId) - 1, 0) }, (_, index) => BigInt(index + 1));
}

function toFallbackProtocolMarket(market: Market): ProtocolMarket {
  return {
    ...market,
    resolutionOracle: deployment.marketAddress,
    tradingStart: market.expiry,
    epochLength: 86_400,
    lastSettledEpoch: 0,
    lastEpochSettlementRequest: 0,
    resolutionRequested: false,
    resolvedOutcomeLabel: "Undetermined",
    onchainOrderCount: market.encryptedOrders,
    onchainStatusCode: 0,
    claimedYesShares: 0n,
    claimedNoShares: 0n,
    pendingYesSharesDelta: 0n,
    pendingNoSharesDelta: 0n,
    isIndexedFallback: true
  };
}

function createProtocolPosition(
  market: ProtocolMarket,
  side: PositionSide,
  sharesRaw: bigint,
  pendingClaimCount: number,
  redeemed: boolean
) {
  if (sharesRaw <= 0n && pendingClaimCount === 0) {
    return null;
  }

  const fallback = mockMarkets.find((entry) => entry.id === market.id);
  const shares = safeBigIntToNumber(sharesRaw);
  const avgPrice = side === "Yes" ? market.yesProbability / 100 : (100 - market.yesProbability) / 100;
  const amount = shares * avgPrice;
  const status = redeemed ? "Claimed" : pendingClaimCount > 0 || market.status !== "Live" ? "Awaiting Claim" : "Active";

  return {
    id: `${market.id}-${side.toLowerCase()}`,
    marketId: market.id,
    slug: market.slug,
    marketQuestion: market.question,
    side,
    shares,
    amount,
    avgPrice,
    status,
    pnl: fallback ? fallback.yesProbability - market.yesProbability : 0,
    expiry: market.expiry,
    pendingClaimCount,
    redeemed,
    redeemable: market.status === "Resolved" && pendingClaimCount === 0 && !redeemed
  } satisfies ProtocolPosition;
}

function resolveMarketBySlug(markets: ProtocolMarket[], slug: string) {
  const exact = markets.find((market) => market.slug === slug);
  if (exact) {
    return exact;
  }

  const prefixedMatch = slug.match(/^market-(\d+)(?:-|$)/);
  if (!prefixedMatch) {
    return undefined;
  }

  return markets.find((market) => market.id === Number(prefixedMatch[1]));
}

function deriveDisplayStatus(statusCode: number, tradingEnd: number, resolutionRequested: boolean): MarketStatus {
  if (statusCode === 3) {
    return "Resolved";
  }
  if (statusCode === 2 || resolutionRequested || tradingEnd * 1000 <= Date.now()) {
    return "Settling";
  }
  return "Live";
}

function deriveYesProbability({
  claimedYesShares,
  claimedNoShares,
  pendingYesSharesDelta,
  pendingNoSharesDelta,
  fallback
}: {
  claimedYesShares: bigint;
  claimedNoShares: bigint;
  pendingYesSharesDelta: bigint;
  pendingNoSharesDelta: bigint;
  fallback: number;
}) {
  const yesTotal = normalizeSignedSupply(claimedYesShares + pendingYesSharesDelta);
  const noTotal = normalizeSignedSupply(claimedNoShares + pendingNoSharesDelta);
  const total = yesTotal + noTotal;

  if (total === 0n) {
    return fallback;
  }

  return Number((yesTotal * 10000n) / total) / 100;
}

function normalizeSignedSupply(value: bigint) {
  return value < 0n ? 0n : value;
}

function buildSyntheticChart(yesProbability: number, orderCount: number) {
  const volumeBase = Math.max(orderCount, 1) * 18_000;

  return [
    { time: "00:00", yes: Math.max(0, yesProbability - 4), no: Math.min(100, 104 - yesProbability), volume: volumeBase },
    { time: "04:00", yes: Math.max(0, yesProbability - 2), no: Math.min(100, 102 - yesProbability), volume: Math.round(volumeBase * 1.08) },
    { time: "08:00", yes: Math.max(0, yesProbability - 1), no: Math.min(100, 101 - yesProbability), volume: Math.round(volumeBase * 1.15) },
    { time: "12:00", yes: yesProbability, no: 100 - yesProbability, volume: Math.round(volumeBase * 1.28) },
    { time: "16:00", yes: Math.min(100, yesProbability + 1.5), no: Math.max(0, 98.5 - yesProbability), volume: Math.round(volumeBase * 1.36) },
    { time: "20:00", yes: yesProbability, no: 100 - yesProbability, volume: Math.round(volumeBase * 1.44) }
  ];
}

function buildTimeline(status: MarketStatus, resolutionRequested: boolean): TimelineItem[] {
  if (status === "Resolved") {
    return [
      { label: "Market created", description: "Owner initialized the market onchain.", state: "completed" },
      { label: "Encrypted trading", description: "Orders were accepted during the active trading window.", state: "completed" },
      { label: "Epoch settlement", description: "CRE settlement roots were finalized for closed epochs.", state: "completed" },
      { label: "Resolution + claims", description: "Market outcome is finalized and redemption can proceed when claim queues are clear.", state: "active" }
    ];
  }

  if (status === "Settling") {
    return [
      { label: "Market created", description: "Owner initialized the market onchain.", state: "completed" },
      { label: "Encrypted trading", description: "Trading has closed and no new protected orders should be accepted.", state: "completed" },
      { label: "Epoch settlement", description: resolutionRequested ? "Resolution has been requested while settlement and claim bookkeeping finishes." : "Closed epochs are being finalized through the CRE settlement workflow.", state: "active" },
      { label: "Resolution + claims", description: "Winning traders will claim once settlement roots and outcome resolution are complete.", state: "upcoming" }
    ];
  }

  return [
    { label: "Market created", description: "Owner initialized the market onchain.", state: "completed" },
    { label: "Encrypted trading", description: "The contract is accepting encrypted order payloads and reserving collateral.", state: "active" },
    { label: "Epoch settlement", description: "Closed epochs will be auctioned and finalized with Merkle-root settlements.", state: "upcoming" },
    { label: "Resolution + claims", description: "Oracle-backed resolution unlocks final redemption after claims are settled.", state: "upcoming" }
  ];
}

function buildTags(question: string, status: MarketStatus) {
  const inferred = inferCategory(question);
  return [inferred, status, "Onchain"];
}

function inferCategory(question: string): MarketCategory {
  const normalized = question.toLowerCase();

  if (normalized.includes("btc") || normalized.includes("eth") || normalized.includes("crypto") || normalized.includes("etf") || normalized.includes("sol")) {
    return "Crypto";
  }
  if (normalized.includes("final") || normalized.includes("league") || normalized.includes("champion") || normalized.includes("match")) {
    return "Sports";
  }
  if (normalized.includes("election") || normalized.includes("senate") || normalized.includes("president") || normalized.includes("vote")) {
    return "Politics";
  }
  return "Macro";
}

function formatResolutionSource(resolutionOracle: Address) {
  return `Resolution oracle ${shortAddress(resolutionOracle)} via CRE workflow`;
}

function mapOutcomeLabel(outcome: number): "Undetermined" | "Yes" | "No" {
  if (outcome === 1) {
    return "Yes";
  }
  if (outcome === 2) {
    return "No";
  }
  return "Undetermined";
}

function buildProtocolSlug(id: number, question: string) {
  return `market-${id}-${slugify(question)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || `market-${Date.now()}`;
}

function toIsoTimestamp(timestamp: number) {
  if (!timestamp) {
    return "1970-01-01T00:00:00.000Z";
  }
  return new Date(timestamp * 1000).toISOString();
}

function microToNumber(value: bigint) {
  return safeBigIntToNumber(value) / 1_000_000;
}

function safeBigIntToNumber(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(value);
}

function shortAddress(value: Address) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
