import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  userSidebar: [
    "learn/index",
    {
      type: "category",
      label: "Understand the Treasury",
      collapsed: false,
      items: [
        "learn/how-it-works",
        "learn/lifecycle-and-snapshots",
        "learn/roles",
      ],
    },
    {
      type: "category",
      label: "Choose an Interface",
      items: ["learn/web-app", "learn/cli", "learn/web-app-screenshots"],
    },
    {
      type: "category",
      label: "Take Part",
      collapsed: false,
      items: [
        "learn/create-a-proposal",
        "learn/vote",
        "learn/results-and-acceptance",
        "learn/execute-a-proposal",
      ],
    },
    {
      type: "category",
      label: "Verify and Respond",
      collapsed: false,
      items: ["learn/verifiability-and-trust", "learn/pause-behavior"],
    },
    "learn/faq",
    "learn/glossary",
  ],
  operatorSidebar: [
    "operate/index",
    {
      type: "category",
      label: "Operator Flow",
      collapsed: false,
      items: [
        "operate/cli/prerequisites",
        "operate/operator-checklist",
        "operate/lifecycle/configure-the-treasury",
        "operate/deployment/deploy-the-treasury",
        "operate/lifecycle/ideal-lifecycle",
      ],
    },
    {
      type: "category",
      label: "Lifecycle Details",
      collapsed: false,
      items: [
        "operate/lifecycle/configuration",
        "operate/lifecycle/voting-capacity-and-period-sizing",
      ],
    },
    {
      type: "category",
      label: "Infrastructure Runbooks",
      link: { type: "doc", id: "operate/infrastructure/index" },
      items: [
        {
          type: "category",
          label: "1. Network",
          collapsed: false,
          items: [
            "operate/infrastructure/archive-node",
            "operate/infrastructure/mina-daemon",
            "operate/infrastructure/staking-ledger-provider",
          ],
        },
        {
          type: "category",
          label: "2. Treasury",
          collapsed: false,
          items: [
            "operate/infrastructure/generate-treasury-wallet",
            "operate/infrastructure/deploy-contracts",
            "operate/infrastructure/deploy-stack",
            "operate/infrastructure/lifecycle-pipeline",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "CLI Reference",
      items: ["operate/reference/cli-commands"],
    },
    "operate/proving/ledgers-and-proving",
    "operate/break-glass/index",
    "operate/failures/index",
    {
      type: "category",
      label: "Architecture",
      link: { type: "doc", id: "operate/architecture/index" },
      items: [
        "operate/architecture/system-topology",
        "operate/architecture/authority-and-trust",
        "operate/architecture/events-and-projections",
      ],
    },
    {
      type: "category",
      label: "Service Operation",
      link: { type: "doc", id: "operate/services/index" },
      items: [
        "operate/services/runtime-components",
        "operate/services/service-operations",
      ],
    },
    {
      type: "category",
      label: "API Reference",
      link: { type: "doc", id: "operate/api/index" },
      items: [
        "operate/api/app-api",
        "operate/api/indexer-api",
        "operate/api/processor-api",
      ],
    },
    {
      type: "category",
      label: "Technical Reference",
      link: { type: "doc", id: "operate/reference/index" },
      items: [
        "operate/reference/protocol-behavior",
        "operate/reference/contract-topology",
        "operate/reference/treasury-owner",
        "operate/reference/treasury-proposal",
        "operate/reference/pause-controller",
        "operate/reference/staking-ledger-to-voting-ledger",
        "operate/reference/vote-reducer",
        "operate/reference/constants-and-acceptance",
        "operate/reference/events",
        "operate/reference/authorization-matrix",
        "operate/reference/environment-fields",
        "operate/reference/developer-reference",
      ],
    },
  ],
};

export default sidebars;
