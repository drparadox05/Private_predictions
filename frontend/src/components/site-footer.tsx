import Link from "next/link";
import { Github, Linkedin, Twitter } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-slate-950/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Private Prediction Markets</p>
          <p className="max-w-xl text-sm text-slate-400">
            Privacy-first markets with encrypted order flow, Chainlink-backed automation, and scalable claim-based settlement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm text-slate-400">
          <Link href="/app" className="transition hover:text-cyan">
            Markets
          </Link>
          <Link href="/portfolio" className="transition hover:text-cyan">
            Portfolio
          </Link>
          <Link href="/create" className="transition hover:text-cyan">
            Create Market
          </Link>
          <div className="flex items-center gap-3 text-slate-300">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="rounded-full border border-white/10 p-2 transition hover:border-cyan/40 hover:text-cyan">
              <Github className="h-4 w-4" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer" className="rounded-full border border-white/10 p-2 transition hover:border-cyan/40 hover:text-cyan">
              <Twitter className="h-4 w-4" />
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="rounded-full border border-white/10 p-2 transition hover:border-cyan/40 hover:text-cyan">
              <Linkedin className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
