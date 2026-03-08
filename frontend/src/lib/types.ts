export type MarketCategory = "Crypto" | "Sports" | "Politics" | "Macro";

export type MarketStatus = "Live" | "Settling" | "Resolved";

export type PositionSide = "Yes" | "No";

export interface ChartPoint {
  time: string;
  yes: number;
  no: number;
  volume: number;
}

export interface TimelineItem {
  label: string;
  description: string;
  state: "completed" | "active" | "upcoming";
}

export interface Market {
  id: number;
  slug: string;
  question: string;
  category: MarketCategory;
  description: string;
  expiry: string;
  resolutionSource: string;
  liquidity: number;
  volume: number;
  traders: number;
  yesProbability: number;
  encryptedOrders: number;
  status: MarketStatus;
  chart: ChartPoint[];
  timeline: TimelineItem[];
  tags: string[];
}

export interface PortfolioPosition {
  id: string;
  marketId: number;
  marketQuestion: string;
  side: PositionSide;
  amount: number;
  avgPrice: number;
  status: "Active" | "Awaiting Claim" | "Resolved" | "Claimed";
  pnl: number;
  expiry: string;
}

export interface PortfolioHistoryItem {
  id: string;
  marketQuestion: string;
  outcome: PositionSide;
  stake: number;
  payout: number;
  pnl: number;
  resolvedAt: string;
}
