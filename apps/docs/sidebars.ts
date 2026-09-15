import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  userSidebar: [
    "learn/index",
    "learn/overview",
    "learn/quickstart",
    "learn/check-your-deployment",
    {
      type: "category",
      label: "Start With The Foundations",
      collapsed: false,
      items: [
        "learn/foundations/mina-basics",
        "learn/foundations/treasury-model",
        "learn/foundations/voting-and-proofs",
        "learn/foundations/on-chain-and-off-chain",
      ],
    },
    {
      type: "category",
      label: "Follow The Complete Flow",
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
      items: [
        "learn/web-app",
        "learn/signing-with-ledger-and-auro",
        "learn/cli",
        "learn/web-app-screenshots",
      ],
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
      items: [
        "learn/verifiability-and-trust",
        "learn/verify-a-proposal",
        "learn/pause-behavior",
      ],
    },
    "learn/faq",
    "learn/glossary",
  ],
  operatorSidebar: [
    "operate/index",
    "operate/overview",
    "operate/quickstart",
    {
      type: "category",
      label: "Start With The Foundations",
      collapsed: false,
      items: [
        "operate/foundations/what-you-operate",
        "operate/foundations/lifecycle-and-proof-work",
        "operate/foundations/state-and-reconciliation",
      ],
    },
    {
      type: "category",
      label: "Run The Operator Flow",
      collapsed: false,
      items: [
        "operate/cli/prerequisites",
        "operate/operator-checklist",
        "operate/deployment/compose-testnet",
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
      ],
    },
  ],
  developerSidebar: [
    "developer/index",
    "developer/overview",
    "developer/local-development/quickstart",
    "developer/local-development/tools",
    {
      type: "category",
      label: "Start With The Foundations",
      collapsed: false,
      items: [
        "developer/foundations/repository-tour",
        "developer/foundations/mina-o1js-and-proofs",
        "developer/foundations/trace-a-treasury-change",
      ],
    },
    {
      type: "category",
      label: "Local Development",
      collapsed: false,
      items: [
        "developer/local-development/network-modes",
        "developer/local-development/full-local-demo",
        "developer/local-development/environment",
        "developer/local-development/native-stack",
        "developer/local-development/local-blockchain",
        "developer/local-development/mina-single-node",
        "developer/local-development/lightnet",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      collapsed: false,
      items: ["developer/architecture/system-overview"],
    },
    {
      type: "category",
      label: "Applications and Services",
      collapsed: false,
      items: [
        "developer/apps/api-runtime",
        "developer/apps/indexer-and-processor",
        "developer/apps/web-app",
        "developer/apps/backoffice",
      ],
    },
    {
      type: "category",
      label: "Provable Layer",
      collapsed: false,
      items: [
        "developer/provable/provable-overview",
        "developer/provable/provable-architecture",
        "developer/provable/provable-workflows",
      ],
    },
    {
      type: "category",
      label: "Developer Operations",
      items: [
        "developer/operations/cli",
        "developer/operations/proving-and-workers",
        "developer/operations/deployments",
        "developer/operations/container-images",
      ],
    },
    {
      type: "category",
      label: "Quality and Maintenance",
      collapsed: false,
      items: [
        "developer/testing",
        "developer/troubleshooting",
        "developer/security",
        "developer/contributing",
        "developer/documentation",
      ],
    },
    {
      type: "category",
      label: "Developer Reference",
      items: [
        "developer/reference/packages",
        "developer/reference/env-and-commands",
        "developer/reference/api-routes",
        "developer/reference/source-documents",
      ],
    },
  ],
};

export default sidebars;
