import { useState } from "react";
import {
  TreasuryLifecyclePeriodInfo,
  type TreasuryLifecyclePeriodId,
  type TreasuryLifecyclePeriodInfoProps,
} from "./lifecycle-period-info";

export default {
  title: "Treasury/LifecyclePeriodInfo",
  component: TreasuryLifecyclePeriodInfo,
  parameters: {
    layout: "fullscreen",
  },
};

export const ProposalPeriod = {
  args: buildLifecycleArgs({
    lifecycleId: 13,
    currentPeriod: "proposal",
    currentPeriodProgress: 24,
    currentSlot: 18462512,
    periodEndsIn: "3 days 10 hours",
  }),
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const ProposalPeriodTablet = {
  args: buildLifecycleArgs({
    lifecycleId: 13,
    currentPeriod: "proposal",
    currentPeriodProgress: 24,
    currentSlot: 18462512,
    periodEndsIn: "3 days 10 hours",
  }),
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const ExplorationPeriod = {
  args: buildLifecycleArgs({
    lifecycleId: 14,
    currentPeriod: "exploration",
    currentPeriodProgress: 41,
    periodEndsIn: "1 day 18 hours",
  }),
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const VotingPeriod = {
  args: buildLifecycleArgs({
    lifecycleId: 12,
    currentPeriod: "voting",
    currentPeriodProgress: 68,
    currentSlot: 18460115,
    periodEndsIn: "1 day 4 hours",
  }),
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const CooldownPeriod = {
  args: buildLifecycleArgs({
    lifecycleId: 15,
    currentPeriod: "cooldown",
    currentPeriodProgress: 84,
    periodEndsIn: "7 hours 12 minutes",
  }),
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const CompletedLifecycle = {
  args: buildLifecycleArgs({
    lifecycleId: 11,
    currentPeriod: "cooldown",
    currentPeriodProgress: 100,
    isHistoricalLifecycle: true,
  }),
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const SelectorFallback = {
  args: {
    ...buildLifecycleArgs({
      lifecycleId: 9,
      currentPeriod: "voting",
      currentPeriodProgress: 52,
      currentSlot: undefined,
      periodEndsIn: "Unavailable",
    }),
    lifecycleOptions: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  } satisfies TreasuryLifecyclePeriodInfoProps,
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <LifecycleStory {...args} />
      </div>
    </div>
  ),
};

export const LoadingState = {
  args: {
    loading: true,
  } satisfies TreasuryLifecyclePeriodInfoProps,
  render: (args: TreasuryLifecyclePeriodInfoProps) => (
    <div className="w-full bg-background p-3 sm:p-6">
      <div className="mx-auto max-w-[84rem]">
        <TreasuryLifecyclePeriodInfo {...args} />
      </div>
    </div>
  ),
};

function LifecycleStory(args: TreasuryLifecyclePeriodInfoProps) {
  const [lifecycleId, setLifecycleId] = useState(args.lifecycleId);

  return (
    <TreasuryLifecyclePeriodInfo
      {...args}
      lifecycleId={lifecycleId}
      onLifecycleChange={setLifecycleId}
    />
  );
}

function buildLifecycleArgs({
  lifecycleId,
  currentPeriod,
  currentPeriodProgress,
  currentSlot,
  periodEndsIn,
  isHistoricalLifecycle,
}: LifecycleStoryArgs): TreasuryLifecyclePeriodInfoProps {
  const periodIndexById: Record<TreasuryLifecyclePeriodId, number> = {
    proposal: 0,
    exploration: 1,
    voting: 2,
    cooldown: 3,
  };
  const proposalStart = 18462144 + (lifecycleId - 13) * 6144;
  const periodLength = 1536;
  const lifecycleStartDate = new Date("2026-04-09T13:00:00.000Z");
  const lifecycleDateOffsetMs = (lifecycleId - 13) * 8 * 24 * 60 * 60 * 1000;
  const periodDurationMs = 2 * 24 * 60 * 60 * 1000;
  const currentPeriodIndex = periodIndexById[currentPeriod];
  const currentPeriodStart = proposalStart + currentPeriodIndex * periodLength;
  const currentPeriodWidth = periodLength - 1;
  const resolvedCurrentSlot =
    currentSlot ??
    Math.min(
      currentPeriodStart + currentPeriodWidth,
      currentPeriodStart +
        Math.round((currentPeriodWidth * currentPeriodProgress) / 100),
    );

  return {
    lifecycleId,
    currentPeriod,
    currentPeriodProgress,
    currentSlot: resolvedCurrentSlot,
    isHistoricalLifecycle,
    periodEndsIn,
    periodMetadata: [
      {
        period: "proposal",
        slotRange: `${proposalStart} - ${proposalStart + periodLength - 1}`,
        estimatedStart: new Date(lifecycleStartDate.getTime() + lifecycleDateOffsetMs).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs,
        ).toISOString(),
      },
      {
        period: "exploration",
        slotRange: `${proposalStart + periodLength} - ${proposalStart + periodLength * 2 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 2,
        ).toISOString(),
      },
      {
        period: "voting",
        slotRange: `${proposalStart + periodLength * 2} - ${proposalStart + periodLength * 3 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 2,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 3,
        ).toISOString(),
      },
      {
        period: "cooldown",
        slotRange: `${proposalStart + periodLength * 3} - ${proposalStart + periodLength * 4 - 1}`,
        estimatedStart: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 3,
        ).toISOString(),
        estimatedEnd: new Date(
          lifecycleStartDate.getTime() + lifecycleDateOffsetMs + periodDurationMs * 4,
        ).toISOString(),
      },
    ],
  };
}

interface LifecycleStoryArgs {
  lifecycleId: number;
  currentPeriod: NonNullable<TreasuryLifecyclePeriodInfoProps["currentPeriod"]>;
  currentPeriodProgress: number;
  currentSlot?: number;
  periodEndsIn?: string;
  isHistoricalLifecycle?: boolean;
}
