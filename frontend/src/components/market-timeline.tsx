import type { TimelineItem } from "@/lib/types";

type MarketTimelineProps = {
  items: TimelineItem[];
};

export function MarketTimeline({ items }: MarketTimelineProps) {
  return (
    <div className="relative flex items-stretch gap-2">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const tone =
          item.state === "completed"
            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
            : item.state === "active"
              ? "border-cyan/40 bg-cyan/10 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400";
        return (
          <div key={`${item.label}-${index}`} className="group flex min-w-0 flex-1 items-center">
            <div className={`relative flex flex-1 items-center gap-3 rounded-2xl border p-4 ${tone}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white/5 text-sm font-bold">
                {index + 1}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{item.label}</p>
                <p className="line-clamp-2 text-xs leading-4 text-slate-300">{item.description}</p>
              </div>
            </div>
            {!isLast ? (
              <div className="mx-2 hidden h-px w-6 bg-white/20 md:block" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
