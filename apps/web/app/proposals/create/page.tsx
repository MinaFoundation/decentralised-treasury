import { ProposalCreatePageContainer } from "../../../features/proposals/containers/proposal-create-page-container";

export default async function ProposalCreatePage({
  searchParams,
}: {
  searchParams: Promise<{
    lifecycleId?: string;
    draftId?: string;
    from?: "dashboard" | "proposals";
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const parsedLifecycleId = Number.parseInt(resolvedSearchParams.lifecycleId ?? "", 10);

  return (
    <ProposalCreatePageContainer
      initialLifecycleId={Number.isFinite(parsedLifecycleId) ? parsedLifecycleId : undefined}
      draftId={resolvedSearchParams.draftId}
      previousPage={resolvedSearchParams.from === "dashboard" ? "dashboard" : "proposals"}
    />
  );
}
