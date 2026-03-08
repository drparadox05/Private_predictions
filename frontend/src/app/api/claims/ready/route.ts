import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import type { Address, Hex } from "viem";
import { sepolia } from "wagmi/chains";

import { deployment, marketAbi } from "@/lib/contract";

export const dynamic = "force-dynamic";

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(sepoliaRpcUrl)
});

type AuctionOrder = {
  orderId: string;
  trader: Address;
  marketId: string;
  epoch: string;
  epochLockedCollateral: string;
  submittedAt: string;
  ciphertext: Hex;
};

type AuctionPayload = {
  marketAddress: Address;
  marketId: string;
  epoch: string;
  orderIds: string[];
  orders: AuctionOrder[];
};

type SettlementClaim = {
  settlement: {
    trader: Address;
    reservedCollateralSpent: string;
    reservedCollateralRefunded: string;
    collateralCredit: string;
    yesSharesDelta: string;
    noSharesDelta: string;
  };
  merkleProof: Hex[];
};

type AuctionSettlementResponse = {
  marketId: string;
  epoch: string;
  clearingPrice: string;
  settlementRoot: Hex;
  totalYesSharesDelta: string;
  totalNoSharesDelta: string;
  settlementHash: Hex;
  claims: SettlementClaim[];
};

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const marketIdParam = request.nextUrl.searchParams.get("marketId");

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid address query parameter is required." }, { status: 400 });
  }

  try {
    const marketIds = marketIdParam ? [BigInt(marketIdParam)] : await discoverQueuedMarkets(address as Address);
    const claims = await collectReadyClaims(address as Address, marketIds);

    return NextResponse.json({
      address,
      claims
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error while preparing claims." },
      { status: 500 }
    );
  }
}

async function discoverQueuedMarkets(address: Address) {
  const nextMarketId = await publicClient.readContract({
    address: deployment.marketAddress,
    abi: marketAbi,
    functionName: "nextMarketId"
  });

  const marketIds = Array.from({ length: Math.max(Number(nextMarketId) - 1, 0) }, (_, index) => BigInt(index + 1));

  if (marketIds.length === 0) {
    return [];
  }

  const claimQueueStates = await publicClient.multicall({
    contracts: marketIds.map((marketId) => ({
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "getClaimQueueState",
      args: [marketId, address]
    })),
    allowFailure: true
  });

  return marketIds.filter((marketId, index) => {
    const result = claimQueueStates[index];
    if (result.status !== "success") {
      return false;
    }

    const claimQueueState = result.result as unknown as readonly [bigint, bigint];
    const pendingClaimCount = claimQueueState[1] ?? 0n;
    return BigInt(pendingClaimCount) > 0n;
  });
}

async function collectReadyClaims(address: Address, marketIds: bigint[]) {
  const readyClaims: Array<{
    marketId: string;
    epoch: string;
    clearingPrice: string;
    settlementRoot: Hex;
    settlement: SettlementClaim["settlement"];
    merkleProof: Hex[];
  }> = [];

  for (const marketId of marketIds) {
    const epochs = await publicClient.readContract({
      address: deployment.marketAddress,
      abi: marketAbi,
      functionName: "getPendingClaimEpochs",
      args: [marketId, address, 16n]
    });

    for (const epoch of epochs) {
      const claimStatus = await publicClient.readContract({
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "getClaimStatus",
        args: [marketId, epoch, address]
      });

      const readyToClaim = Boolean(claimStatus[1]);
      const onchainSettlementRoot = claimStatus[5] as Hex;
      const clearingPrice = claimStatus[4];

      if (!readyToClaim) {
        continue;
      }

      const orderIds = await publicClient.readContract({
        address: deployment.marketAddress,
        abi: marketAbi,
        functionName: "getEpochOrderIds",
        args: [marketId, epoch]
      });

      const orders = await Promise.all(
        orderIds.map(async (orderId) => {
          const order = await publicClient.readContract({
            address: deployment.marketAddress,
            abi: marketAbi,
            functionName: "orders",
            args: [orderId]
          });

          const trader = order[0] as Address;
          const marketIdValue = BigInt(order[1]);
          const epochValue = BigInt(order[2]);
          const epochLockedCollateral = await publicClient.readContract({
            address: deployment.marketAddress,
            abi: marketAbi,
            functionName: "epochReservedCollateral",
            args: [marketIdValue, epochValue, trader]
          });

          return {
            orderId: orderId.toString(),
            trader,
            marketId: marketIdValue.toString(),
            epoch: epochValue.toString(),
            epochLockedCollateral: BigInt(epochLockedCollateral).toString(),
            submittedAt: BigInt(order[3]).toString(),
            ciphertext: order[4] as Hex
          } satisfies AuctionOrder;
        })
      );

      const auctionPayload: AuctionPayload = {
        marketAddress: deployment.marketAddress,
        marketId: marketId.toString(),
        epoch: epoch.toString(),
        orderIds: orderIds.map((orderId) => orderId.toString()),
        orders
      };

      const auctionResponse = await fetch(deployment.auctionServiceUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(auctionPayload),
        cache: "no-store"
      });

      if (!auctionResponse.ok) {
        throw new Error(`Auction service returned ${auctionResponse.status} while preparing claims.`);
      }

      const settlement = (await auctionResponse.json()) as AuctionSettlementResponse;
      if (settlement.settlementRoot.toLowerCase() !== onchainSettlementRoot.toLowerCase()) {
        throw new Error(`Settlement root mismatch for market ${marketId.toString()} epoch ${epoch.toString()}.`);
      }

      const matchingClaim = settlement.claims.find(
        (claim) => claim.settlement.trader.toLowerCase() === address.toLowerCase()
      );

      if (!matchingClaim) {
        continue;
      }

      readyClaims.push({
        marketId: marketId.toString(),
        epoch: epoch.toString(),
        clearingPrice: BigInt(clearingPrice).toString(),
        settlementRoot: settlement.settlementRoot,
        settlement: matchingClaim.settlement,
        merkleProof: matchingClaim.merkleProof
      });
    }
  }

  return readyClaims;
}

function isAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
