import { MarketDetailClient } from "@/components/market-detail-client";

type MarketDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function MarketDetailPage({ params }: MarketDetailPageProps) {
  const { slug } = await params;
  return <MarketDetailClient slug={slug} />;
}
