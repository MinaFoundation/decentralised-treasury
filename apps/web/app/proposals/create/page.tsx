import { ProposalCreatePageContainer } from "../../../features/proposals/containers/proposal-create-page-container";

export default async function ProposalCreatePage({
  searchParams,
}: {
  searchParams: Promise<{
    draftId?: string;
    from?: "dashboard" | "proposals";
  }>;
}) {
  const resolvedSearchParams = await searchParams;

  return (
    <ProposalCreatePageContainer
      draftId={resolvedSearchParams.draftId}
      previousPage={
        resolvedSearchParams.from === "dashboard" ? "dashboard" : "proposals"
      }
    />
  );
}
