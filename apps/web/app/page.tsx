import { DashboardContainer } from "../features/dashboard/containers/dashboard-container";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lifecycleId?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const parsedLifecycleId = Number.parseInt(resolvedSearchParams.lifecycleId ?? "", 10);

  return (
    <DashboardContainer
      initialLifecycleId={Number.isFinite(parsedLifecycleId) ? parsedLifecycleId : undefined}
    />
  );
}
