"use client";

import { LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { MarketCard } from "@/components/market-card";
import { Button } from "@/components/ui/button";
import { useProtocolMarkets } from "@/lib/protocol";
import type { MarketCategory, MarketStatus } from "@/lib/types";

const categories: Array<MarketCategory | "All"> = ["All", "Crypto", "Sports", "Politics", "Macro"];
const statuses: Array<MarketStatus | "All"> = ["All", "Live", "Settling", "Resolved"];

export function MarketExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketCategory | "All">("All");
  const [status, setStatus] = useState<MarketStatus | "All">("All");
  const { data: markets = [], isLoading, error } = useProtocolMarkets();
  const shouldShowError = Boolean(error) && markets.length === 0;

  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      const matchesQuery =
        query.length === 0 ||
        market.question.toLowerCase().includes(query.toLowerCase()) ||
        market.tags.some((tag) => tag.toLowerCase().includes(query.toLowerCase()));
      const matchesCategory = category === "All" || market.category === category;
      const matchesStatus = status === "All" || market.status === status;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [category, markets, query, status]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr_0.8fr_auto]">
        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          <Search className="h-4 w-4 text-cyan" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by market, narrative, or tag"
            className="w-full bg-transparent text-white outline-none placeholder:text-slate-500"
          />
        </label>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as MarketCategory | "All")}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 outline-none"
        >
          {categories.map((item) => (
            <option key={item} value={item} className="bg-slate-950">
              {item}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as MarketStatus | "All")}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 outline-none"
        >
          {statuses.map((item) => (
            <option key={item} value={item} className="bg-slate-950">
              {item}
            </option>
          ))}
        </select>
        <Button variant="secondary" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-slate-300">
          <LoaderCircle className="h-4 w-4 animate-spin text-cyan" />
          Loading live markets from the deployed contract…
        </div>
      ) : null}
      {shouldShowError ? (
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 px-6 py-6 text-sm text-rose-100">
          Unable to load live markets right now. Please verify your RPC settings and deployed contract address.
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        {filteredMarkets.map((market) => (
          <MarketCard key={market.id} market={market} />
        ))}
      </div>
      {!isLoading && !shouldShowError && filteredMarkets.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 px-6 py-12 text-center text-sm text-slate-400">
          No markets matched the current filters.
        </div>
      ) : null}
    </div>
  );
}
