import { CreateMarketWizard } from "@/components/create-market-wizard";
import { SectionHeading } from "@/components/section-heading";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <div className="space-y-8">
        <SectionHeading
          eyebrow="Create"
          title="Spin up a new protected market"
          description="A guided creation flow for admins and operators. The UI is opinionated about validation, role separation, and safe deployment sequencing."
        />
        <CreateMarketWizard />
      </div>
    </div>
  );
}
