"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { WalletConnectButton } from "@/components/wallet-connect-button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview" },
  { href: "/app", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/create", label: "Create" }
];

export function SiteHeader() {
  const pathname = usePathname();
  const currentPath = pathname ?? "";

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/55 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan/30 bg-cyan/10 text-sm font-black text-cyan shadow-neon">
            SM
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.34em] text-cyan/70">ShadowMarket</p>
          </div>
        </Link>
        <nav className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1 md:flex">
          {links.map((link) => {
            const active = currentPath === link.href || (link.href !== "/" && currentPath.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-full px-4 py-2 text-sm transition",
                  active ? "bg-gradient-to-r from-cyan/80 to-purple/80 text-slate-950" : "text-slate-300 hover:text-white"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <WalletConnectButton />
      </div>
    </header>
  );
}
