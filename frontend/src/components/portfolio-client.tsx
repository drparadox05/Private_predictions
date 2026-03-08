"use client";

import Link from "next/link";
import { ArrowUpRight, LoaderCircle, ShieldCheck, Wallet } from "lucide-react";
import { useMemo } from "react";
import { useAccount } from "wagmi";

import { ClaimRewardsButton } from "@/components/claim-rewards-button";
import { ClaimSettlementButton } from "@/components/claim-settlement-button";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { usePortfolioSnapshot } from "@/lib/protocol";
import { formatCurrency, formatPercentage, getTimeRemainingLabel } from "@/lib/utils";

export function PortfolioClient() {
  const { address, isConnected } = useAccount();
  const { data, isLoading, error } = usePortfolioSnapshot(address);

  const primaryRedeemMarketId = useMemo(() => data?.redeemableMarketIds[0], [data?.redeemableMarketIds]);

  if (!isConnected) {
    return (
      <Panel className="p-8 text-center text-slate-300">
        Connect a wallet to load live positions, claim queue state, and redemption history.
      </Panel>
    );
  }

  if (isLoading) {
    return (
      <Panel className="flex items-center gap-3 p-6 text-slate-300">
        <LoaderCircle className="h-5 w-5 animate-spin text-cyan" />
        Loading your portfolio from onchain market state…
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="p-8 text-center text-slate-300">
        Unable to load your live portfolio right now. {error.message}
      </Panel>
    );
  }

  const positions = data?.positions ?? [];
  const history = data?.history ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-4 md:grid-cols-3 md:flex-1">
          <StatCard icon={Wallet} label="Active exposure" value={formatCurrency(data?.totals.activeExposure ?? 0)} helper="Derived from current onchain share balances" />
          <StatCard icon={ShieldCheck} label="Awaiting claims" value={formatCurrency(data?.totals.awaitingClaims ?? 0)} helper="Markets with pending claim queue or closed state" />
          <StatCard icon={ArrowUpRight} label="Realized payouts" value={formatCurrency(data?.totals.realizedPayouts ?? 0)} helper={`${history.length} redeem events detected`} />
        </div>
        <ClaimRewardsButton marketId={primaryRedeemMarketId} disabled={!primaryRedeemMarketId} label={primaryRedeemMarketId ? "Redeem first available" : "No redeemable markets"} />
      </div>

      <Panel className="overflow-hidden">
        <div className="border-b border-white/5 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Active positions</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Live holdings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/5 text-left text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-6 py-4 font-medium">Market</th>
                <th className="px-6 py-4 font-medium">Side</th>
                <th className="px-6 py-4 font-medium">Shares</th>
                <th className="px-6 py-4 font-medium">Notional</th>
                <th className="px-6 py-4 font-medium">Avg Price</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Action</th>
                <th className="px-6 py-4 font-medium">Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {positions.length > 0 ? (
                positions.map((position) => (
                  <tr key={position.id} className="hover:bg-white/[0.03]">
                    <td className="px-6 py-4 text-white">
                      <Link href={`/app/markets/${position.slug}`} className="hover:text-cyan">
                        {position.marketQuestion}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-slate-300">{position.side}</td>
                    <td className="px-6 py-4 text-slate-300">{position.shares.toFixed(2)}</td>
                    <td className="px-6 py-4 text-slate-300">{formatCurrency(position.amount)}</td>
                    <td className="px-6 py-4 text-slate-300">{formatPercentage(position.avgPrice * 100)}</td>
                    <td className="px-6 py-4"><StatusBadge status={position.status} /></td>
                    <td className="px-6 py-4">
                      {position.pendingClaimCount > 0 ? (
                        <ClaimSettlementButton marketId={position.marketId} pendingClaimCount={position.pendingClaimCount} />
                      ) : (
                        <ClaimRewardsButton
                          marketId={position.redeemable ? position.marketId : undefined}
                          disabled={!position.redeemable}
                          label={position.redeemable ? "Redeem" : "Not ready"}
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-400">{getTimeRemainingLabel(position.expiry)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                    No active positions detected from onchain balances yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="border-b border-white/5 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">History</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Redeem events</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/5 text-left text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-6 py-4 font-medium">Market</th>
                <th className="px-6 py-4 font-medium">Outcome</th>
                <th className="px-6 py-4 font-medium">Payout</th>
                <th className="px-6 py-4 font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.length > 0 ? (
                history.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.03]">
                    <td className="px-6 py-4 text-white">
                      <Link href={`/app/markets/${item.slug}`} className="hover:text-cyan">
                        {item.marketQuestion}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-slate-300">{item.outcome}</td>
                    <td className="px-6 py-4 text-emerald-300">{formatCurrency(item.payout)}</td>
                    <td className="px-6 py-4 text-slate-400">{new Date(item.resolvedAt).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-400">
                    No redeem events detected for this wallet yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, helper }: { icon: typeof Wallet; label: string; value: string; helper: string }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
        <Icon className="h-4 w-4 text-cyan" />
      </div>
      <p className="mt-4 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{helper}</p>
    </Panel>
  );
}
