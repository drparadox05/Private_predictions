import type { TimelineItem } from "@/lib/types";

type MarketTimelineProps = {
  items: TimelineItem[];
};

export function MarketTimeline({ items }: MarketTimelineProps) {
  return (
    <div className="space-y-5">
      {items.map((item, index) => {
        const tone =
          item.state === "completed"
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : item.state === "active"
              ? "border-cyan/30 bg-cyan/10 text-cyan-100"
              : "border-white/10 bg-white/5 text-slate-400";

        return (
          <div key={`${item.label}-${index}`} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${tone}`}>{index + 1}</div>
              {index < items.length - 1 ? <div className="mt-2 h-full w-px bg-white/10" /> : null}
            </div>
            <div className="pb-4">
              <p className="text-base font-semibold text-white">{item.label}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
