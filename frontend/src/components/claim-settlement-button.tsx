"use client";

import { CheckCheck, LoaderCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { deployment, marketAbi } from "@/lib/contract";
import { useReadyClaims } from "@/lib/protocol";

type ClaimSettlementButtonProps = {
  marketId?: number;
  pendingClaimCount?: number;
};

export function ClaimSettlementButton({ marketId, pendingClaimCount = 0 }: ClaimSettlementButtonProps) {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useReadyClaims(address, marketId);
  const { data: hash, isPending, writeContractAsync } = useWriteContract();
  const { isSuccess, isError, error: txError } = useWaitForTransactionReceipt({ hash });

  const claim = useMemo(() => data?.claims[0], [data?.claims]);

  useEffect(() => {
    if (!isSuccess || !claim) {
      return;
    }

    toast.success("Settlement claimed", {
      description: `Claimed market ${claim.marketId} epoch ${claim.epoch}.`
    });
    void queryClient.invalidateQueries({ queryKey: ["ready-claims"] });
    void queryClient.invalidateQueries({ queryKey: ["portfolio-snapshot"] });
    void queryClient.invalidateQueries({ queryKey: ["protocol-markets"] });
  }, [claim, isSuccess, queryClient]);

  useEffect(() => {
    if (!isError) {
      return;
    }

    toast.error("Claim failed", {
      description: txError?.message ?? "The claim transaction was rejected or reverted."
    });
  }, [isError, txError?.message]);

  if (!isConnected) {
    return (
      <Button disabled className="gap-2">
        <CheckCheck className="h-4 w-4" />
        Connect wallet
      </Button>
    );
  }

  if (pendingClaimCount === 0 && !claim) {
    return (
      <Button disabled className="gap-2">
        <CheckCheck className="h-4 w-4" />
        No claims
      </Button>
    );
  }

  if (isLoading) {
    return (
      <Button disabled className="gap-2">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Checking claims...
      </Button>
    );
  }

  if (error) {
    return (
      <Button disabled className="gap-2">
        <CheckCheck className="h-4 w-4" />
        Claim unavailable
      </Button>
    );
  }

  return (
    <Button
      className="gap-2"
      disabled={!claim || isPending}
      onClick={() => {
        if (!claim) {
          toast.error("No ready claim found yet.", {
            description: pendingClaimCount > 0 ? "This wallet still has pending settlements, but the next epoch is not yet ready to claim." : "No pending claim epochs were found for this market."
          });
          return;
        }

        void writeContractAsync({
          address: deployment.marketAddress,
          abi: marketAbi,
          functionName: "claimEpochSettlement",
          args: [
            BigInt(claim.marketId),
            BigInt(claim.epoch),
            {
              trader: claim.settlement.trader,
              reservedCollateralSpent: BigInt(claim.settlement.reservedCollateralSpent),
              reservedCollateralRefunded: BigInt(claim.settlement.reservedCollateralRefunded),
              collateralCredit: BigInt(claim.settlement.collateralCredit),
              yesSharesDelta: BigInt(claim.settlement.yesSharesDelta),
              noSharesDelta: BigInt(claim.settlement.noSharesDelta)
            },
            claim.merkleProof
          ]
        });
      }}
    >
      <CheckCheck className="h-4 w-4" />
      {isPending ? "Claiming..." : claim ? `Claim epoch ${claim.epoch}` : `${pendingClaimCount} pending`}
    </Button>
  );
}
