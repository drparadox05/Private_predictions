import type { TimelineItem } from "@/lib/types";

type MarketTimelineProps = {
  items: TimelineItem[];
};

export function MarketTimeline({ items }: MarketTimelineProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {items.map((item, index) => {
        const tone =
          item.state === "completed"
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : item.state === "active"
              ? "border-cyan/30 bg-cyan/10 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400";

        return (
          <div key={`${item.label}-${index}`} className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-4">
            {index < items.length - 1 ? <div className="absolute left-[calc(50%+1.5rem)] right-[-1rem] top-8 hidden h-px bg-white/10 md:block" /> : null}
            <div className="flex items-center gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${tone}`}>{index + 1}</div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Step {index + 1}</p>
                <p className="mt-1 text-sm font-semibold text-white">{item.label}</p>
              </div>
            </div>
            <div className="mt-3">
              <p className="text-xs leading-5 text-slate-400">{item.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
