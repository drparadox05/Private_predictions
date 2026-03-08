import { CollateralManager } from "@/components/collateral-manager";
import { MarketExplorer } from "@/components/market-explorer";
import { SectionHeading } from "@/components/section-heading";
import { Panel } from "@/components/ui/panel";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <div className="space-y-8">
        <SectionHeading
          eyebrow="Dashboard"
          title="Explore private markets"
          description="Scan live encrypted markets, monitor your protocol collateral, and drill into settlement-aware details without clutter."
        />
        <div className="w-full">
          <CollateralManager />
        </div>
        <Panel className="p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Market Explorer</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Live opportunities</h2>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-300">
              Grid view
            </div>
          </div>
          <MarketExplorer />
        </Panel>
      </div>
    </div>
  );
}
