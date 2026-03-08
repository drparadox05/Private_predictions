"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { deployment, marketAbi } from "@/lib/contract";

const steps = ["Question", "Schedule", "Resolution", "Review"] as const;

export function CreateMarketWizard() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    question: "Will ETH stake participation exceed 35% by year-end?",
    category: "Crypto",
    tradingStartDateTime: toDateTimeLocalValue(new Date(Date.now() + 15 * 60_000)),
    tradingEndDateTime: toDateTimeLocalValue(new Date(Date.now() + 24 * 60 * 60_000)),
    epochLengthMinutes: "60",
    resolutionSource: "Chainlink oracle workflow",
    oracleAddress: "0x3C5Ed30498037E20c0ced1F1581EA8F8234A7282"
  });
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { data: hash, isPending, writeContractAsync } = useWriteContract();
  const { isSuccess, isError, error } = useWaitForTransactionReceipt({ hash });

  const summary = useMemo(
    () => [
      { label: "Question", value: form.question },
      { label: "Category", value: form.category },
      { label: "Trading start", value: formatDateTimeSummary(form.tradingStartDateTime) },
      { label: "Trading end", value: formatDateTimeSummary(form.tradingEndDateTime) },
      { label: "Epoch length", value: `${form.epochLengthMinutes} minutes` },
      { label: "Source", value: form.resolutionSource },
      { label: "Oracle", value: form.oracleAddress }
    ],
    [form]
  );

  useEffect(() => {
    if (!isSuccess) {
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["protocol-markets"] });

    toast.success("Market creation submitted", {
      description: "The owner-only createMarket transaction was confirmed onchain. Refreshing the market explorer."
    });

    router.push("/app");
  }, [isSuccess, queryClient, router]);

  useEffect(() => {
    if (!isError) {
      return;
    }

    toast.error("Market creation failed", {
      description: error?.message ?? "The transaction was rejected or reverted."
    });
  }, [error?.message, isError]);

  async function handleCreateMarket() {
    const tradingStartMs = new Date(form.tradingStartDateTime).getTime();
    const tradingEndMs = new Date(form.tradingEndDateTime).getTime();
    const epochLengthMinutes = Number(form.epochLengthMinutes);
    const tradingStart = BigInt(Math.floor(tradingStartMs / 1000));
    const tradingEnd = BigInt(Math.floor(tradingEndMs / 1000));
    const epochLength = BigInt(epochLengthMinutes * 60);
    const nowInSeconds = Math.floor(Date.now() / 1000);

    if (!isConnected || !address) {
      toast.error("Connect the owner wallet before creating a market.");
      return;
    }

    if (!form.question.trim()) {
      toast.error("Enter a market question before submitting.");
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(form.oracleAddress)) {
      toast.error("Enter a valid resolution oracle address.");
      return;
    }

    if (!Number.isFinite(tradingStartMs) || !Number.isFinite(tradingEndMs)) {
      toast.error("Enter valid trading start and end date/time values.");
      return;
    }

    if (!Number.isInteger(epochLengthMinutes) || epochLengthMinutes <= 0) {
      toast.error("Epoch length must be a whole number of minutes greater than zero.");
      return;
    }

    if (tradingStart <= BigInt(nowInSeconds)) {
      toast.error("Trading start must be in the future.");
      return;
    }

    if (tradingEnd <= tradingStart) {
      toast.error("Trading end must be later than trading start.");
      return;
    }

    if (!publicClient) {
      toast.error("Public client unavailable. Check your chain RPC configuration.");
      return;
    }

    const contractOwner = await publicClient.readContract({
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "owner"
    });

    if (contractOwner.toLowerCase() !== address.toLowerCase()) {
      toast.error("Only the contract owner can create markets.", {
        description: `Connected wallet ${address} does not match owner ${contractOwner}.`
      });
      return;
    }

    const args = [form.question.trim(), form.oracleAddress as Address, tradingStart, tradingEnd, epochLength] as const;

    const estimatedGas = await publicClient.estimateContractGas({
      account: address,
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "createMarket",
      args
    });

    const gas = (estimatedGas * 12n) / 10n;
    const maxGas = 16_000_000n;

    await writeContractAsync({
      account: address,
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "createMarket",
      args,
      gas: gas > maxGas ? maxGas : gas
    });
  }

  return (
    <Panel className="p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-cyan/70">Create Market</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Launch a private market</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {steps.map((label, index) => (
            <div
              key={label}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.24em] ${
                index === step
                  ? "border-cyan/30 bg-cyan/10 text-cyan-100"
                  : index < step
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-slate-500"
              }`}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          {step === 0 ? (
            <>
              <label className="block text-sm text-slate-300">
                Market question
                <textarea
                  value={form.question}
                  onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
                  className="mt-2 min-h-36 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Category
                <select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                >
                  <option className="bg-slate-950">Crypto</option>
                  <option className="bg-slate-950">Sports</option>
                  <option className="bg-slate-950">Politics</option>
                  <option className="bg-slate-950">Macro</option>
                </select>
              </label>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <label className="block text-sm text-slate-300">
                Trading start date and time
                <input
                  type="datetime-local"
                  value={form.tradingStartDateTime}
                  onChange={(event) => setForm((current) => ({ ...current, tradingStartDateTime: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Trading end date and time
                <input
                  type="datetime-local"
                  value={form.tradingEndDateTime}
                  onChange={(event) => setForm((current) => ({ ...current, tradingEndDateTime: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Epoch length in minutes
                <input
                  inputMode="numeric"
                  value={form.epochLengthMinutes}
                  onChange={(event) => setForm((current) => ({ ...current, epochLengthMinutes: event.target.value.replace(/[^\d]/g, "") }))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </label>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <label className="block text-sm text-slate-300">
                Resolution source
                <input
                  value={form.resolutionSource}
                  onChange={(event) => setForm((current) => ({ ...current, resolutionSource: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Resolution oracle address
                <input
                  value={form.oracleAddress}
                  onChange={(event) => setForm((current) => ({ ...current, oracleAddress: event.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </label>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                This contract stores the question, oracle, trading start, trading end, and epoch length onchain. It does not accept initial liquidity during market creation.
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
              {summary.map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-slate-400">{item.label}</span>
                  <span className="max-w-[60%] text-right text-white">{item.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-between gap-3 pt-2">
            <Button variant="ghost" className="gap-2" onClick={() => setStep((current) => Math.max(current - 1, 0))} disabled={step === 0}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {step < steps.length - 1 ? (
              <Button className="gap-2" onClick={() => setStep((current) => Math.min(current + 1, steps.length - 1))}>
                Next
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                className="gap-2"
                onClick={() => void handleCreateMarket()}
                disabled={isPending}
              >
                <CheckCircle2 className="h-4 w-4" />
                {isPending ? "Submitting..." : "Create market onchain"}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-cyan/20 bg-cyan/10 p-5">
            <div className="flex items-center gap-3 text-cyan-100">
              <LockKeyhole className="h-5 w-5" />
              <p className="text-sm font-semibold uppercase tracking-[0.24em]">Safety Checklist</p>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-200">
              <p>Use a dedicated owner wallet or multisig for market creation.</p>
              <p>Validate oracle identity, trading windows, and epoch length before opening the market.</p>
              <p>Keep encryption public keys versioned so clients can safely compose ciphertext payloads.</p>
              <p>Register Automation and CRE callbacks separately after market creation so every epoch and final resolution can execute.</p>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">
            The current contract exposes `createMarket(...)` as `onlyOwner`. Collateral deposits, Automation upkeeps, and CRE workflows are separate operational steps after market creation.
          </div>
        </div>
      </div>
    </Panel>
  );
}

function toDateTimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTimeSummary(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return timestamp.toLocaleString();
}
