"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { parseUnits } from "viem";
import { toast } from "sonner";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { deployment, marketAbi } from "@/lib/contract";
import { encryptOrderPayload } from "@/lib/order-encryption";
import type { Market } from "@/lib/types";
import { formatPercentage } from "@/lib/utils";

const MAX_WRITE_GAS = 16_000_000n;

function withGasBuffer(estimatedGas: bigint) {
  const gas = (estimatedGas * 12n) / 10n;
  return gas > MAX_WRITE_GAS ? MAX_WRITE_GAS : gas;
}

type OrderTicketProps = {
  market: Market;
};

export function OrderTicket({ market }: OrderTicketProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [tradeSide, setTradeSide] = useState<"BUY" | "SELL">("BUY");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [shareAmount, setShareAmount] = useState("100");
  const [limitPriceInput, setLimitPriceInput] = useState(String(market.yesProbability));
  const [lockAmount, setLockAmount] = useState("250");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { writeContractAsync } = useWriteContract();

  const selectedImpliedProbability = useMemo(
    () => (outcome === "YES" ? market.yesProbability : 100 - market.yesProbability),
    [market.yesProbability, outcome]
  );

  const numericShareAmount = Number(shareAmount) || 0;
  const numericLimitPrice = Number(limitPriceInput) || 0;
  const numericLockAmount = Number(lockAmount) || 0;

  const estimatedOrderValue = useMemo(() => {
    const price = numericLimitPrice / 100;
    if (price <= 0 || numericShareAmount <= 0) {
      return 0;
    }
    return numericShareAmount * price;
  }, [numericLimitPrice, numericShareAmount]);

  const devPayloadSummary = useMemo(() => {
    return `${tradeSide} ${outcome} @ ${limitPriceInput || "0"}%`;
  }, [limitPriceInput, outcome, tradeSide]);

  async function handleConfirm() {
    setShowConfirmation(false);

    if (!isConnected) {
      toast.error("Connect a wallet to continue.");
      return;
    }

    if (!address) {
      toast.error("Connected wallet address unavailable.");
      return;
    }

    if (market.status !== "Live") {
      toast.error("This market is not currently accepting new orders.");
      return;
    }

    if (!deployment.auctionServicePublicKey) {
      toast.error("Auction encryption key is not configured.", {
        description: "Set NEXT_PUBLIC_AUCTION_SERVICE_PUBLIC_KEY before submitting encrypted orders."
      });
      return;
    }

    if (!publicClient) {
      toast.error("Public client unavailable.", {
        description: "Check your RPC configuration before submitting orders."
      });
      return;
    }

    let collateralToReserve: bigint;
    let orderShareSize: bigint;
    try {
      collateralToReserve = parseUnits(lockAmount || "0", 6);
      orderShareSize = parseUnits(shareAmount || "0", 6);
    } catch {
      toast.error("Enter valid order size and collateral values.");
      return;
    }

    if (collateralToReserve <= 0n) {
      toast.error("Enter a valid epoch lock amount.");
      return;
    }

    if (orderShareSize <= 0n) {
      toast.error("Enter a valid share amount.");
      return;
    }

    if (!Number.isFinite(numericLimitPrice) || numericLimitPrice <= 0 || numericLimitPrice > 100) {
      toast.error("Enter a valid limit price between 0 and 100.");
      return;
    }

    const outcomePrice = BigInt(Math.max(1, Math.round(numericLimitPrice * 10_000)));
    const requiredBuyLock = (orderShareSize * outcomePrice) / 1_000_000n;

    if (tradeSide === "BUY" && collateralToReserve < requiredBuyLock) {
      toast.error("Epoch lock is too small for this BUY order.", {
        description: `Increase the lock to at least $${(Number(requiredBuyLock) / 1_000_000).toFixed(2)} to cover the full order at your limit price.`
      });
      return;
    }

    const payload = {
      version: 1,
      chainId: deployment.chainId,
      marketAddress: deployment.marketAddress,
      marketId: String(market.id),
      submittedBy: address,
      side: tradeSide,
      outcome,
      size: orderShareSize.toString(),
      limitPrice: outcomePrice.toString(),
      createdAt: Math.floor(Date.now() / 1000)
    };

    setIsSubmitting(true);

    let lockConfirmed = false;
    try {
      const currentEpoch = await publicClient.readContract({
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "getCurrentEpoch",
        args: [BigInt(market.id)]
      });
      const encryptedPayload = await encryptOrderPayload(payload, deployment.auctionServicePublicKey);

      const lockArgs = [BigInt(market.id), currentEpoch, collateralToReserve] as const;
      const estimatedLockGas = await publicClient.estimateContractGas({
        account: address,
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "lockEpochCollateral",
        args: lockArgs
      });

      const lockHash = await writeContractAsync({
        account: address,
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "lockEpochCollateral",
        args: lockArgs,
        gas: withGasBuffer(estimatedLockGas)
      });
      await publicClient.waitForTransactionReceipt({ hash: lockHash });
      lockConfirmed = true;

      const submitArgs = [BigInt(market.id), encryptedPayload] as const;
      const estimatedSubmitGas = await publicClient.estimateContractGas({
        account: address,
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "submitEncryptedOrder",
        args: submitArgs
      });

      const submitHash = await writeContractAsync({
        account: address,
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "submitEncryptedOrder",
        args: submitArgs,
        gas: withGasBuffer(estimatedSubmitGas)
      });
      await publicClient.waitForTransactionReceipt({ hash: submitHash });

      toast.success("Order submitted to contract", {
        description: "Collateral was locked for the current epoch and the client-encrypted payload was submitted onchain for settlement."
      });
    } catch (submitError) {
      toast.error("Order submission failed", {
        description:
          submitError instanceof Error
            ? lockConfirmed
              ? `${submitError.message} Collateral remains locked for the current epoch until you either retry submission or call unlockEpochCollateral manually.`
              : submitError.message
            : lockConfirmed
              ? "Collateral remains locked for the current epoch until you either retry submission or call unlockEpochCollateral manually."
              : "The transaction was rejected or reverted."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Panel className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan/70">Encrypted Order Entry</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Place a protected position</h3>
          </div>
          <div className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs uppercase tracking-[0.26em] text-cyan-100">
            {formatPercentage(selectedImpliedProbability)} implied
          </div>
        </div>
        <div className="mt-6 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Order side</p>
            <div className="mt-3 grid grid-cols-2 rounded-2xl border border-white/10 bg-slate-950/70 p-1.5">
              {(["BUY", "SELL"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setTradeSide(option)}
                  className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    tradeSide === option
                      ? option === "BUY"
                        ? "bg-emerald-500 text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.3)]"
                        : "bg-rose-500 text-white shadow-[0_0_24px_rgba(244,63,94,0.25)]"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Outcome</p>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tap to select side</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["YES", "NO"] as const).map((option) => {
                const isSelected = outcome === option;
                const selectedClasses = option === "YES" ? "border-emerald-400/40 bg-emerald-400/12 text-white shadow-[0_0_24px_rgba(16,185,129,0.18)]" : "border-rose-400/40 bg-rose-400/12 text-white shadow-[0_0_24px_rgba(244,63,94,0.16)]";

                return (
                  <button
                    key={option}
                    onClick={() => setOutcome(option)}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${isSelected ? selectedClasses : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan/20 hover:bg-white/10"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-lg font-semibold">{option}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${option === "YES" ? "bg-emerald-500/15 text-emerald-200" : "bg-rose-500/15 text-rose-200"}`}>
                        {formatPercentage(option === "YES" ? market.yesProbability : 100 - market.yesProbability)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{option === "YES" ? "Buy exposure if you expect the event to happen." : "Buy exposure if you expect the event not to happen."}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm text-slate-300">
            Share amount
            <input
              value={shareAmount}
              onChange={(event) => setShareAmount(event.target.value.replace(/[^\d.]/g, ""))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
              placeholder="100"
              inputMode="decimal"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Limit price (%)
            <input
              value={limitPriceInput}
              onChange={(event) => setLimitPriceInput(event.target.value.replace(/[^\d.]/g, ""))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
              placeholder="63"
              inputMode="decimal"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Epoch lock (USDC)
            <input
              value={lockAmount}
              onChange={(event) => setLockAmount(event.target.value.replace(/[^\d.]/g, ""))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
              placeholder="250"
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          <div className="flex items-center justify-between">
            <span>{tradeSide === "BUY" ? "Max order value" : "Expected proceeds at limit"}</span>
            <span className="font-semibold text-white">${estimatedOrderValue.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span>Selected outcome</span>
            <span className="font-semibold text-white">{outcome}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span>Reference implied price</span>
            <span className="font-semibold text-white">{formatPercentage(selectedImpliedProbability)}</span>
          </div>
          <div className="mt-2 flex items-start gap-2 text-slate-400">
            <Lock className="mt-0.5 h-4 w-4 text-cyan" />
            <span>
              This flow first locks collateral for the active epoch, then encrypts the exact BUY/SELL payload in the browser before broadcasting opaque bytes onchain for auction-service settlement.
            </span>
          </div>
        </div>
        <Button className="mt-5 w-full gap-2" onClick={() => setShowConfirmation(true)} disabled={isSubmitting || market.status !== "Live"}>
          <ShieldCheck className="h-4 w-4" />
          {isSubmitting ? "Locking + submitting..." : market.status === "Live" ? "Review order payload" : "Market closed"}
        </Button>
      </Panel>
      {showConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
          <Panel className="w-full max-w-lg p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan/70">Confirmation</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Review onchain payload</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              This path locks collateral for the current epoch, then encrypts the order payload to the auction service public key before submission. Onchain observers can still see market, epoch, timing metadata, and the total epoch lock.
            </p>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Market</span>
                <span className="max-w-[55%] text-right text-white">{market.question}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Order side</span>
                <span className="text-white">{tradeSide}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Outcome</span>
                <span className="text-white">{outcome}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Share amount</span>
                <span className="text-white">{shareAmount || "0"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Limit price</span>
                <span className="text-white">{limitPriceInput || "0"}%</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Epoch lock</span>
                <span className="text-white">${lockAmount || "0"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Payload preview</span>
                <span className="text-right text-white">{devPayloadSummary}</span>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowConfirmation(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleConfirm()}>
                Confirm
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
