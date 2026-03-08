import Link from "next/link";
import { ArrowRight, Binary, CircleDollarSign, LockKeyhole, ShieldCheck, Sparkles, Telescope, Wallet } from "lucide-react";

import { AnimatedCounter } from "@/components/animated-counter";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { protocolStats, technologyCards } from "@/lib/mock-data";

const flow = [
  {
    title: "Create Market",
    description: "Define a market with explicit trading windows, resolution rails, and collateral parameters.",
    icon: Binary
  },
  {
    title: "Place Encrypted Bet",
    description: "Users submit sealed order payloads while collateral is reserved onchain without revealing intent.",
    icon: LockKeyhole
  },
  {
    title: "Resolve & Claim",
    description: "Chainlink workflows settle epochs, finalize outcomes, and let traders claim payouts safely.",
    icon: ShieldCheck
  }
] as const;

export default function LandingPage() {
  return (
    <div>
      <section className="mx-auto max-w-7xl px-6 pb-24 pt-16 lg:px-8 lg:pb-28 lg:pt-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-cyan/70">Privacy-first trading rails</p>
            <h1 className="mt-5 max-w-4xl font-[var(--font-orbitron)] text-5xl font-semibold leading-tight text-white md:text-6xl">
              Privacy-First Prediction Markets
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Trade on predictions without revealing your strategy. Submit encrypted orders, lock collateral for each trading epoch, and let Chainlink settle outcomes privately. Your positions stay hidden until the market closes—then claim your winnings through verifiable Merkle proofs.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/app">
                <Button className="gap-2 px-6 py-3">
                  Launch App
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="#how-it-works">
                <Button variant="secondary" className="px-6 py-3">
                  Learn More
                </Button>
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {protocolStats.map((stat) => (
                <Panel key={stat.label} className="p-5">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-500">{stat.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    <AnimatedCounter value={stat.value} prefix={stat.label.includes("TVL") ? "$" : ""} />
                  </p>
                </Panel>
              ))}
            </div>
          </div>
          <Panel className="relative overflow-hidden p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_30%),radial-gradient(circle_at_20%_80%,rgba(139,92,246,0.16),transparent_28%)]" />
            <div className="relative space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-xs uppercase tracking-[0.28em] text-cyan-100">
                <Sparkles className="h-4 w-4" />
                Encrypted order flow
              </div>
              <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/55 p-6 shadow-neon">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">Live Market Signal</p>
                  <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-cyan-100">
                    Shielded
                  </span>
                </div>
                <h3 className="text-2xl font-semibold text-white">Will BTC settle above $120k by Q2 end?</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Yes odds</p>
                    <p className="mt-2 text-3xl font-semibold text-cyan">63%</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Settlement rail</p>
                    <p className="mt-2 text-lg font-semibold text-white">Chainlink CRE</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-dashed border-cyan/20 bg-cyan/5 p-4 text-sm text-slate-300">
                  Orders remain sealed until the epoch ends and the offchain auction engine decrypts and settles them.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </section>

      <section id="why" className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
          <Panel className="p-7 border-red-500/20 bg-red-500/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-2 w-2 rounded-full bg-red-500" />
              <p className="text-xs uppercase tracking-[0.28em] text-red-400">THE PROBLEM</p>
            </div>
            <h2 className="text-3xl font-semibold text-white mb-4">Your trades are public before they execute</h2>
            
            <div className="space-y-4">
              <div className="flex gap-3">
                <span className="text-red-400 font-mono">→</span>
                <p className="text-sm text-slate-300">You place a $10k bet on "YES"</p>
              </div>
              <div className="flex gap-3">
                <span className="text-red-400 font-mono">→</span>
                <p className="text-sm text-slate-300">Bots see it in the mempool instantly</p>
              </div>
              <div className="flex gap-3">
                <span className="text-red-400 font-mono">→</span>
                <p className="text-sm text-slate-300">They frontrun you, steal your alpha</p>
              </div>
              <div className="flex gap-3">
                <span className="text-red-400 font-mono">→</span>
                <p className="text-sm text-slate-300">You get worse prices (or no fill)</p>
              </div>
            </div>
            
            <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
              <p className="text-xs text-red-300 mb-1">This is called:</p>
              <p className="text-lg font-semibold text-white">The Dark Forest</p>
              <a href="https://www.paradigm.xyz/2020/08/ethereum-is-a-dark-forest" target="_blank" rel="noopener noreferrer" className="text-xs text-red-400 hover:text-red-300 mt-2 inline-block">
                Read Paradigm's article →
              </a>
            </div>
          </Panel>
          
          <Panel className="p-7 border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <p className="text-xs uppercase tracking-[0.28em] text-emerald-400">THE SOLUTION</p>
            </div>
            <h2 className="text-3xl font-semibold text-white mb-4">Sealed orders, fair settlement</h2>
            
            <div className="space-y-4">
              <div className="flex gap-3">
                <span className="text-emerald-400 font-mono">01</span>
                <div>
                  <p className="text-sm font-medium text-white">Lock collateral</p>
                  <p className="text-xs text-slate-400">Visible onchain, but no order details</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-emerald-400 font-mono">02</span>
                <div>
                  <p className="text-sm font-medium text-white">Submit encrypted payload</p>
                  <p className="text-xs text-slate-400">Opaque bytes, unreadable by anyone</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-emerald-400 font-mono">03</span>
                <div>
                  <p className="text-sm font-medium text-white">Batch settlement</p>
                  <p className="text-xs text-slate-400">Chainlink CRE decrypts offchain</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-emerald-400 font-mono">04</span>
                <div>
                  <p className="text-sm font-medium text-white">Claim position</p>
                  <p className="text-xs text-slate-400">Merkle proof, verifiable onchain</p>
                </div>
              </div>
            </div>
            
            <div className="mt-6 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <p className="text-lg font-semibold text-white mb-1">Your strategy stays hidden</p>
              <p className="text-sm text-emerald-300">The market cannot frontrun what it cannot see</p>
            </div>
          </Panel>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="A private execution lifecycle built for clarity"
          description="The protocol separates encrypted intake, batched settlement, and payout claims so the interface can stay simple while execution remains private."
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {flow.map((item, index) => (
            <Panel key={item.title} className="p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan/20 bg-cyan/10 text-cyan shadow-neon">
                <item.icon className="h-5 w-5" />
              </div>
              <p className="mt-5 text-xs uppercase tracking-[0.28em] text-cyan/70">Step {index + 1}</p>
              <h3 className="mt-3 text-2xl font-semibold text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-400">{item.description}</p>
            </Panel>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <Panel className="p-7">
            <SectionHeading
              eyebrow="Privacy features"
              title="Sealed orders, no visible intent"
              description="The frontend is designed around the protocol’s real guarantees: collateral accounting is visible, but order contents remain opaque until controlled offchain settlement occurs."
            />
            <div className="mt-8 space-y-4 text-sm leading-7 text-slate-300">
              <p>Orders are intended to be encrypted client-side before submission.</p>
              <p>Collateral is now locked at the epoch level, which hides per-order sizing while still preserving transparent account balances.</p>
              <p>Epoch settlement and market resolution remain explicit, which makes status, timelines, and claim readiness easy to show in the interface.</p>
            </div>
          </Panel>
          <div className="grid gap-6 sm:grid-cols-2">
            {technologyCards.map((card) => (
              <Panel key={card.title} className="p-6">
                <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Technology</p>
                <h3 className="mt-3 text-xl font-semibold text-white">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-400">{card.description}</p>
              </Panel>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
