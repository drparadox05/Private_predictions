import { NextResponse } from "next/server";

import { deployment } from "@/lib/contract";

export const dynamic = "force-dynamic";

export async function GET() {
  const [auction, resolution] = await Promise.all([
    checkService("Auction service", deployment.auctionServiceUrl),
    checkService("Resolution service", deployment.resolutionServiceUrl)
  ]);

  return NextResponse.json({
    auction,
    resolution,
    checkedAt: new Date().toISOString()
  });
}

async function checkService(label: string, rawUrl: string) {
  const url = toHealthUrl(rawUrl);

  try {
    const response = await fetch(url, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        ok: false,
        label,
        url,
        error: `Health check returned ${response.status}`
      };
    }

    return {
      ok: true,
      label,
      url
    };
  } catch (error) {
    return {
      ok: false,
      label,
      url,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

function toHealthUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.pathname = "/health";
  url.search = "";
  return url.toString();
}
