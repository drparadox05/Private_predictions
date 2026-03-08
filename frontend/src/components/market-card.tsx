import Link from "next/link";
import { ArrowRight, LockKeyhole, Users } from "lucide-react";

import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Market } from "@/lib/types";
import { formatCompactNumber, formatCurrency, formatPercentage, getTimeRemainingLabel } from "@/lib/utils";

type MarketCardProps = {
  market: Market;
};

export function MarketCard({ market }: MarketCardProps) {
  return (
    <Panel className="group flex h-full flex-col justify-between p-6 transition hover:-translate-y-1 hover:border-cyan/30">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">{market.category}</p>
            <h3 className="mt-3 text-xl font-semibold text-white">{market.question}</h3>
          </div>
          <StatusBadge status={market.status} />
        </div>
        <p className="text-sm leading-6 text-slate-400">{market.description}</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-300">
            <span>Yes odds</span>
            <span>{formatPercentage(market.yesProbability)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-purple" style={{ width: `${market.yesProbability}%` }} />
          </div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>No {formatPercentage(100 - market.yesProbability)}</span>
            <span>{getTimeRemainingLabel(market.expiry)}</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.26em] text-slate-500">Volume</p>
            <p className="mt-2 text-sm font-semibold text-white">{formatCurrency(market.volume)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.26em] text-slate-500">Liquidity</p>
            <p className="mt-2 text-sm font-semibold text-white">{formatCurrency(market.liquidity)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.26em] text-slate-500">Traders</p>
            <p className="mt-2 text-sm font-semibold text-white">{formatCompactNumber(market.traders)}</p>
          </div>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-5 text-sm text-slate-300">
        <div className="flex items-center gap-2">
          <LockKeyhole className="h-4 w-4 text-cyan" />
          <span>{market.encryptedOrders} encrypted orders</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Users className="h-4 w-4" />
          <span>{formatCompactNumber(market.traders)}</span>
        </div>
      </div>
      <Link href={`/app/markets/${market.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-cyan transition hover:text-cyan-200">
        View market
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </Link>
    </Panel>
  );
}
