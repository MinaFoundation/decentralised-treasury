import { ProposalDetailPageContainer } from "../../../features/proposals/containers/proposal-detail-page-container";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;

  return <ProposalDetailPageContainer proposalId={decodeURIComponent(proposalId)} />;
}
