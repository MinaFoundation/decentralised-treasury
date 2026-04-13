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
      apiStatus: "healthy",
      indexerStatus: "healthy",
      latestLiveSlot: 18459301,
      latestLiveBlock: 450920,
      latestIndexedSlot: 18459298,
      latestIndexedBlock: 450919,
      slotLag: 3,
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
      apiStatus: "healthy",
      indexerStatus: "degraded",
      latestLiveSlot: 450122,
      latestLiveBlock: 7935,
      latestIndexedSlot: 450091,
      latestIndexedBlock: 7927,
      slotLag: 31,
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
      apiStatus: "down",
      indexerStatus: "unknown",
      latestLiveSlot: null,
      latestLiveBlock: null,
      latestIndexedSlot: null,
      latestIndexedBlock: null,
      slotLag: null,
      updatedAt: "2m ago",
    },
  } satisfies TreasuryStatusFooterProps,
  render: (args: TreasuryStatusFooterProps) => (
    <div className="w-full bg-background px-3 py-2 sm:px-6">
      <TreasuryStatusFooter {...args} />
    </div>
  ),
};
