import { PortfolioClient } from "@/components/portfolio-client";
import { SectionHeading } from "@/components/section-heading";

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <div className="space-y-8">
        <SectionHeading
          eyebrow="Portfolio"
          title="Track positions and claim flow"
          description="Monitor active encrypted bets, see claim readiness, and review realized performance after resolution."
        />
        <PortfolioClient />
      </div>
    </div>
  );
}
