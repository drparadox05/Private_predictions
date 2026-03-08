"use client";

import { Gift } from "lucide-react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { deployment, marketAbi } from "@/lib/contract";

type ClaimRewardsButtonProps = {
  disabled?: boolean;
  label?: string;
  marketId?: number;
};

export function ClaimRewardsButton({ disabled = false, label = "Claim Rewards", marketId }: ClaimRewardsButtonProps) {
  const queryClient = useQueryClient();
  const { data: hash, isPending, writeContractAsync } = useWriteContract();
  const { isSuccess, isError, error } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!isSuccess || marketId === undefined) {
      return;
    }

    toast.success("Redemption confirmed", {
      description: `Redeemed resolved payout for market ${marketId}.`
    });
    void queryClient.invalidateQueries({ queryKey: ["portfolio-snapshot"] });
    void queryClient.invalidateQueries({ queryKey: ["ready-claims"] });
    void queryClient.invalidateQueries({ queryKey: ["protocol-markets"] });
  }, [isSuccess, marketId, queryClient]);

  useEffect(() => {
    if (!isError) {
      return;
    }

    toast.error("Redemption failed", {
      description: error?.message ?? "The redeem transaction was rejected or reverted."
    });
  }, [error?.message, isError]);

  return (
    <Button
      className="gap-2"
      disabled={disabled || marketId === undefined || isPending}
      onClick={() => {
        if (marketId === undefined) {
          toast.error("No redeemable market selected.", {
            description: "A market can only be redeemed after resolution and once its claim queue is fully cleared."
          });
          return;
        }

        void writeContractAsync({
          address: deployment.marketAddress,
          abi: marketAbi,
          functionName: "redeem",
          args: [BigInt(marketId)]
        });
      }}
    >
      <Gift className="h-4 w-4" />
      {isPending ? "Redeeming..." : label}
    </Button>
  );
}
