import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-cyan to-purple text-slate-950 shadow-neon transition hover:scale-[1.01] hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "border border-white/10 bg-white/5 text-foreground transition hover:border-cyan/40 hover:bg-cyan/10 disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "text-slate-200 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "border border-rose-500/30 bg-rose-500/10 text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold tracking-wide",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
});
