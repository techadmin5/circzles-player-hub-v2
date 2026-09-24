import { Construction } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/kit";

export function FeatureUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader kicker="Coming later" title={title} subtitle={description} />
      <EmptyState
        icon={<Construction size={22} />}
        title={`${title} is not available yet`}
        body="This area stays disabled until its persistent backend and production API are ready. No demo data is shown."
      />
    </>
  );
}
