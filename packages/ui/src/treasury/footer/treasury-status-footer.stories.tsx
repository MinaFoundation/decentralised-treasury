import {
  TreasuryStatusFooter,
  type TreasuryStatusFooterProps,
} from "./treasury-status-footer";

export default {
  title: "Treasury/TreasuryStatusFooter",
  component: TreasuryStatusFooter,
  parameters: {
    layout: "fullscreen",
  },
};

export const HealthyMainnet = {
  args: {
    networkId: "MAINNET",
    health: {
      nodeBlockHeight: 450920,
      nodeFresh: true,
      archiveBlockHeight: 450920,
      archiveFresh: true,
      indexerBlockHeight: 450920,
      indexerFresh: true,
      processorRemainingEvents: 0,
      processorFresh: true,
      updatedAt: "just now",
    },
  },
  render: (args: TreasuryStatusFooterProps) => (
    <div className="w-full bg-background px-3 py-2 sm:px-6">
      <TreasuryStatusFooter {...args} />
    </div>
  ),
};

export const LaggingLightnet = {
  args: {
    networkId: "LIGHTNET",
    health: {
      nodeBlockHeight: 7935,
      nodeFresh: true,
      archiveBlockHeight: 7933,
      archiveFresh: true,
      indexerBlockHeight: 7927,
      indexerFresh: true,
      processorRemainingEvents: 4,
      processorFresh: true,
      updatedAt: "23s ago",
    },
  },
  render: (args: TreasuryStatusFooterProps) => (
    <div className="w-full bg-background px-3 py-2 sm:px-6">
      <TreasuryStatusFooter {...args} />
    </div>
  ),
};

export const DownWithUnknownChain = {
  args: {
    networkId: "DEVNET",
    health: {
      nodeBlockHeight: null,
      nodeFresh: false,
      archiveBlockHeight: null,
      archiveFresh: false,
      indexerBlockHeight: null,
      indexerFresh: false,
      processorRemainingEvents: null,
      processorFresh: false,
      updatedAt: "2m ago",
    },
  } satisfies TreasuryStatusFooterProps,
  render: (args: TreasuryStatusFooterProps) => (
    <div className="w-full bg-background px-3 py-2 sm:px-6">
      <TreasuryStatusFooter {...args} />
    </div>
  ),
};
