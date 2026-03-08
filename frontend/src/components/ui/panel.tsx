import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-border bg-panel/90 backdrop-blur-xl shadow-[0_24px_80px_rgba(5,8,22,0.45)]",
        className
      )}
      {...props}
    />
  );
}
