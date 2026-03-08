import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: string;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone =
    status === "Live"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : status === "Settling" || status === "Awaiting Claim"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : status === "Resolved" || status === "Claimed"
          ? "border-cyan/30 bg-cyan/10 text-cyan-100"
          : "border-white/10 bg-white/5 text-slate-200";

  return (
    <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.28em]", tone)}>
      {status}
    </span>
  );
}
