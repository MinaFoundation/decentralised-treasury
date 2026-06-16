const sidebars = {
  userSidebar: [
    "index",
    {
      type: "category",
      label: "User Guide",
      collapsed: false,
      items: [
        "user/index",
        "user/concepts",
        "user/roles-and-permissions",
        {
          type: "doc",
          id: "user/proposal-lifecycle",
          label: "Proposal Journey",
        },
        {
          type: "doc",
          id: "user/lifecycle-calendar",
          label: "Treasury Calendar",
        },
        "user/voting-and-results",
        {
          type: "doc",
          id: "user/support-requirements-and-results",
          label: "Support Requirements",
        },
        "user/funding-and-payouts",
        "user/pause-and-governance",
        "user/verifiability-and-trust",
        "user/using-the-web-app",
        "user/using-the-command-line",
        "user/day-to-day-operation",
        "user/faq",
        "user/glossary",
      ],
    },
  ],
  developerSidebar: [
    "developer/index",
    {
      type: "category",
      label: "Architecture",
      collapsed: false,
      items: [
        "developer/architecture/system-overview",
        "developer/apps/web-app",
        "developer/apps/api-runtime",
        "developer/apps/indexer-and-processor",
      ],
    },
    {
      type: "category",
      label: "Local Development",
      collapsed: false,
      items: [
        "developer/local-development/quickstart",
        "developer/local-development/environment",
        "developer/local-development/local-blockchain",
      ],
    },
    {
      type: "category",
      label: "Operations",
      collapsed: false,
      items: [
        "developer/operations/cli",
        "developer/operations/proving-and-workers",
        "developer/operations/deployments",
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
      label: "Reference",
      collapsed: true,
      items: [
        "developer/testing",
        "developer/troubleshooting",
        "developer/reference/env-and-commands",
        "developer/reference/api-routes",
        "developer/reference/packages",
        "developer/contributing",
        "developer/security",
      ],
    },
  ],
  specsSidebar: [
    "specs/index",
    {
      type: "category",
      label: "Provable Specs",
      collapsed: false,
      items: [
        "specs/provable/provable-primitives",
        "specs/provable/treasury-owner",
        "specs/provable/treasury-proposal",
        "specs/provable/treasury-pause-controller",
        "specs/provable/staking-ledger-to-voting-ledger",
        "specs/provable/vote-reducer",
      ],
    },
  ],
};

export default sidebars;
