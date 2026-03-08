"use client";

import Link from "next/link";
import { BarChart3, Clock3, LoaderCircle, Shield, Vault } from "lucide-react";

import { MarketChart } from "@/components/market-chart";
import { MarketOrderBook } from "@/components/market-order-book";
import { MarketTimeline } from "@/components/market-timeline";
import { OrderTicket } from "@/components/order-ticket";
import { Panel } from "@/components/ui/panel";
import { useProtocolMarket, useProtocolMarkets } from "@/lib/protocol";
import { formatCompactNumber, formatCurrency, formatPercentage, getTimeRemainingLabel } from "@/lib/utils";

export function MarketDetailClient({ slug }: { slug: string }) {
  const { data: market, isLoading, error } = useProtocolMarket(slug);
  const { data: allMarkets } = useProtocolMarkets();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <Panel className="flex items-center gap-3 p-6 text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin text-cyan" />
          Loading live market data from the deployed contract…
        </Panel>
      </div>
    );
  }

  if (!market || error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12 lg:px-8">
        <Panel className="p-8 text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Market unavailable</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">We couldn’t resolve that market route.</h1>
          <p className="mt-4 text-base text-slate-400">This slug did not match a mock route or a detected onchain market.</p>
          <Link href="/app" className="mt-6 inline-flex text-sm font-medium text-cyan hover:text-cyan-200">
            Return to dashboard
          </Link>
        </Panel>
      </div>
    );
  }

  const related = (allMarkets ?? []).filter((entry) => entry.slug !== market.slug).slice(0, 2);

  return (
    <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-8">
          <Panel className="p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan/70">{market.category}</p>
                <h1 className="mt-3 max-w-4xl text-4xl font-semibold text-white">{market.question}</h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-400">{market.description}</p>
              </div>
              <div className="rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-cyan-100">
                {market.status}
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={BarChart3} label="Yes probability" value={formatPercentage(market.yesProbability)} helper="Derived from onchain net share supply" />
              <MetricCard icon={Vault} label="Liquidity proxy" value={formatCurrency(market.liquidity)} helper="Order and share activity estimate" />
              <MetricCard icon={Clock3} label="Time remaining" value={getTimeRemainingLabel(market.expiry)} helper="Trading end from contract state" />
              <MetricCard icon={Shield} label="Orders submitted" value={formatCompactNumber(market.onchainOrderCount)} helper="Onchain encrypted payload count" />
            </div>
          </Panel>

          <Panel className="p-7">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Odds chart</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Probability and momentum</h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-300">
                Live-derived snapshot
              </div>
            </div>
            <MarketChart data={market.chart} />
          </Panel>

          <div className="grid gap-8 lg:grid-cols-2">
            <Panel className="p-7">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Order book</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Protected placeholders</h2>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                The contract only stores opaque order payload bytes. Public UI should not reveal raw pre-settlement intent, so this remains intentionally abstract even with live contract wiring.
              </p>
              <div className="mt-6">
                <MarketOrderBook />
              </div>
            </Panel>

            <Panel className="p-7">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Resolution timeline</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Lifecycle</h2>
              <div className="mt-6">
                <MarketTimeline items={market.timeline} />
              </div>
            </Panel>
          </div>
        </div>

        <div className="space-y-8">
          <OrderTicket market={market} />
          <Panel className="p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Resolution data</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Settlement rails</h3>
            <div className="mt-5 space-y-3 text-sm">
              <ResolutionRow label="Resolution source" value={market.resolutionSource} />
              <ResolutionRow label="Resolution oracle" value={market.resolutionOracle} />
              <ResolutionRow label="Resolved outcome" value={market.resolvedOutcomeLabel} />
              <ResolutionRow label="Last settled epoch" value={String(market.lastSettledEpoch)} />
              <ResolutionRow label="Market tags" value={market.tags.join(" • ")} />
            </div>
          </Panel>
          <Panel className="p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Related markets</p>
            <div className="mt-4 space-y-4">
              {related.length > 0 ? (
                related.map((entry) => (
                  <Link key={entry.slug} href={`/app/markets/${entry.slug}`} className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-cyan/30 hover:bg-cyan/5">
                    <p className="text-sm font-semibold text-white">{entry.question}</p>
                    <p className="mt-2 text-sm text-slate-400">Yes {formatPercentage(entry.yesProbability)} • {entry.category}</p>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-slate-400">No related markets detected yet.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, helper }: { icon: typeof BarChart3; label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
        <Icon className="h-4 w-4 text-cyan" />
      </div>
      <p className="mt-3 text-lg font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{helper}</p>
    </div>
  );
}

function ResolutionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-slate-400">{label}</span>
      <span className="max-w-[58%] break-all text-right text-white">{value}</span>
    </div>
  );
}
