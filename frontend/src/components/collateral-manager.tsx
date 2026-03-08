"use client";

import { Coins, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { toast } from "sonner";
import { useAccount, useBalance, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { deployment, erc20Abi, marketAbi } from "@/lib/contract";
import { formatCurrency } from "@/lib/utils";

export function CollateralManager() {
  const [isMounted, setIsMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("100");
  const [pendingAction, setPendingAction] = useState<"approve" | "deposit" | "withdraw" | null>(null);
  const { data: walletBalance } = useBalance({
    address,
    token: deployment.usdcAddress,
    query: {
      enabled: Boolean(address),
      refetchOnWindowFocus: false,
      retry: 0
    }
  });
  const { data: state } = useReadContracts({
    allowFailure: false,
    contracts: address
      ? [
          {
            address: deployment.marketAddress,
            abi: marketAbi,
            functionName: "freeCollateral",
            args: [address]
          },
          {
            address: deployment.marketAddress,
            abi: marketAbi,
            functionName: "reservedCollateral",
            args: [address]
          },
          {
            address: deployment.usdcAddress,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, deployment.marketAddress]
          }
        ]
      : [],
    query: {
      enabled: Boolean(address),
      refetchOnWindowFocus: false,
      retry: 0
    }
  });
  const { data: hash, isPending, writeContractAsync } = useWriteContract();
  const { isSuccess, isError, error } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!isSuccess || !pendingAction) {
      return;
    }

    toast.success(`${capitalize(pendingAction)} confirmed`, {
      description: pendingAction === "approve" ? "USDC allowance updated for the market contract." : pendingAction === "deposit" ? "Collateral deposited into protocol free balance." : "Collateral withdrawn back to your wallet."
    });
    setPendingAction(null);
  }, [isSuccess, pendingAction]);

  useEffect(() => {
    if (!isError || !pendingAction) {
      return;
    }

    toast.error(`${capitalize(pendingAction)} failed`, {
      description: error?.message ?? "Transaction reverted or was rejected."
    });
    setPendingAction(null);
  }, [error?.message, isError, pendingAction]);

  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseUnits(amount, 6) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const freeCollateral = state?.[0] ?? 0n;
  const reservedCollateral = state?.[1] ?? 0n;
  const allowance = state?.[2] ?? 0n;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const walletValue = isMounted && walletBalance ? `${Number(walletBalance.formatted).toFixed(2)} ${walletBalance.symbol}` : "Connect wallet";
  const statusCopy = !isMounted
    ? "Connect a wallet to manage USDC approvals and protocol collateral."
    : isConnected
      ? isPending && pendingAction
        ? `${capitalize(pendingAction)} transaction pending…`
        : "Deposits move approved USDC into protocol free collateral. Orders now lock collateral at the epoch level rather than attaching visible per-order reservation amounts."
      : "Connect a wallet to manage USDC approvals and protocol collateral.";

  async function handleApprove() {
    if (!isConnected || parsedAmount <= 0n) {
      toast.error("Connect a wallet and enter a valid amount.");
      return;
    }

    setPendingAction("approve");
    await writeContractAsync({
      address: deployment.usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [deployment.marketAddress, parsedAmount]
    });
  }

  async function handleDeposit() {
    if (!isConnected || parsedAmount <= 0n) {
      toast.error("Connect a wallet and enter a valid amount.");
      return;
    }

    setPendingAction("deposit");
    await writeContractAsync({
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "deposit",
      args: [parsedAmount]
    });
  }

  async function handleWithdraw() {
    if (!isConnected || parsedAmount <= 0n) {
      toast.error("Connect a wallet and enter a valid amount.");
      return;
    }

    setPendingAction("withdraw");
    await writeContractAsync({
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "withdraw",
      args: [parsedAmount]
    });
  }

  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Collateral manager</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Approve, deposit, withdraw</h3>
        </div>
        <Wallet className="h-5 w-5 text-cyan" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Metric icon={Coins} label="Wallet" value={walletValue} helper="Available wallet balance" />
        <Metric icon={ShieldCheck} label="Free collateral" value={formatCurrency(Number(freeCollateral) / 1_000_000)} helper="Available to lock into active epochs" />
        <Metric icon={Wallet} label="Locked" value={formatCurrency(Number(reservedCollateral) / 1_000_000)} helper={`${formatCurrency(Number(allowance) / 1_000_000)} approved`} />
      </div>
      <label className="mt-6 block text-sm text-slate-300">
        USDC amount
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
          placeholder="100"
          inputMode="decimal"
        />
      </label>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Button variant="secondary" onClick={() => void handleApprove()} disabled={isPending || parsedAmount <= 0n}>
          Approve USDC
        </Button>
        <Button onClick={() => void handleDeposit()} disabled={isPending || parsedAmount <= 0n || allowance < parsedAmount}>
          Deposit
        </Button>
        <Button variant="ghost" className="border border-white/10 bg-white/5" onClick={() => void handleWithdraw()} disabled={isPending || parsedAmount <= 0n || freeCollateral < parsedAmount}>
          Withdraw
        </Button>
      </div>
      <p className="mt-4 text-sm text-slate-400">{statusCopy}</p>
    </Panel>
  );
}

function Metric({ icon: Icon, label, value, helper }: { icon: typeof Wallet; label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
        <Icon className="h-4 w-4 text-cyan" />
      </div>
      <p className="mt-3 text-lg font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{helper}</p>
    </div>
  );
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
