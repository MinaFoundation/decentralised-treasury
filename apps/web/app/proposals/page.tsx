import { ProposalsPageContainer } from "../../features/proposals/containers/proposals-page-container";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ lifecycleId?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const parsedLifecycleId = Number.parseInt(resolvedSearchParams.lifecycleId ?? "", 10);

  return (
    <ProposalsPageContainer
      lifecycleId={Number.isFinite(parsedLifecycleId) ? parsedLifecycleId : undefined}
    />
  );
}
