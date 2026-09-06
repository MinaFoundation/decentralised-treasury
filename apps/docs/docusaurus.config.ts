import type { Config } from "@docusaurus/types";
import type { Options, ThemeConfig } from "@docusaurus/preset-classic";

const config: Config = {
  title: "Mina Decentralized Treasury",
  tagline: "User and operator documentation",
  url: process.env.DOCS_URL ?? "https://minafoundation.github.io",
  baseUrl: process.env.DOCS_BASE_URL ?? "/decentralised-treasury/",
  customFields: {
    treasuryAppUrl: process.env.TREASURY_APP_URL ?? "http://127.0.0.1:3100",
  },
  organizationName: "MinaFoundation",
  projectName: "decentralised-treasury",
  trailingSlash: false,
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    mermaid: true,
  },
  themes: ["@docusaurus/theme-mermaid"],
  plugins: [
    [
      "@docusaurus/plugin-client-redirects",
      {
        redirects: [
          {
            to: "/learn/",
            from: ["/user"],
          },
          {
            to: "/learn/how-it-works",
            from: [
              "/user/concepts",
              "/user/day-to-day-operation",
              "/user/proposal-lifecycle",
            ],
          },
          {
            to: "/learn/lifecycle-and-snapshots",
            from: ["/user/lifecycle-calendar"],
          },
          {
            to: "/learn/roles",
            from: ["/user/roles-and-permissions"],
          },
          {
            to: "/learn/results-and-acceptance",
            from: ["/user/support-requirements-and-results"],
          },
          {
            to: "/learn/vote",
            from: ["/user/voting-and-results"],
          },
          {
            to: "/learn/execute-a-proposal",
            from: ["/user/funding-and-payouts"],
          },
          {
            to: "/learn/pause-behavior",
            from: ["/user/pause-and-governance"],
          },
          {
            to: "/learn/verifiability-and-trust",
            from: ["/user/verifiability-and-trust"],
          },
          {
            to: "/learn/web-app",
            from: ["/user/using-the-web-app"],
          },
          {
            to: "/learn/cli",
            from: ["/user/using-the-command-line"],
          },
          { to: "/learn/faq", from: ["/user/faq"] },
          { to: "/learn/glossary", from: ["/user/glossary"] },
          {
            to: "/operate/",
            from: ["/start-here"],
          },
          {
            to: "/operate/infrastructure/",
            from: ["/runbooks"],
          },
          {
            to: "/operate/operator-checklist",
            from: ["/runbooks/shift"],
          },
          {
            to: "/operate/architecture/authority-and-trust",
            from: [
              "/system/authority-and-components",
              "/system/data-and-trust-boundaries",
            ],
          },
          {
            to: "/operate/architecture/",
            from: ["/system", "/developer/architecture/system-overview"],
          },
          {
            to: "/operate/lifecycle/configure-the-treasury",
            from: [
              "/environment-creation",
              "/developer/local-development/environment",
              "/developer/local-development/quickstart",
            ],
          },
          {
            to: "/operate/deployment/deploy-the-treasury",
            from: [
              "/runbooks/deployment-upgrade-capacity",
              "/runbooks/backup-and-restore",
              "/developer/operations/deployments",
              "/operate/deployment/environment-and-deployment",
            ],
          },
          {
            to: "/operate/lifecycle/ideal-lifecycle",
            from: [
              "/golden-path",
              "/golden-path/reconciliation",
              "/runbooks/transaction-verification",
            ],
          },
          {
            to: "/operate/cli/prerequisites",
            from: ["/golden-path/signing-and-ledger"],
          },
          {
            to: "/operate/reference/cli-commands",
            from: ["/developer/operations/cli"],
          },
          {
            to: "/operate/proving/ledgers-and-proving",
            from: [
              "/runbooks/proof-operations",
              "/developer/operations/proving-and-workers",
              "/developer/provable/provable-workflows",
            ],
          },
          {
            to: "/operate/break-glass/",
            from: [
              "/runbooks/backoffice-signing",
              "/runbooks/pause-and-break-glass",
            ],
          },
          {
            to: "/operate/failures/",
            from: [
              "/failures",
              "/developer/security",
              "/developer/troubleshooting",
            ],
          },
          {
            to: "/operate/services/",
            from: [
              "/runbooks/service-operations",
              "/developer/apps/indexer-and-processor",
            ],
          },
          {
            to: "/operate/api/",
            from: [
              "/developer/apps/api-runtime",
              "/developer/reference/api-routes",
            ],
          },
          {
            to: "/operate/reference/",
            from: ["/contracts", "/specs"],
          },
          {
            to: "/operate/reference/protocol-behavior",
            from: ["/contracts/lifecycle-and-assets"],
          },
          {
            to: "/operate/reference/authorization-matrix",
            from: ["/contracts/authorization-and-invariants"],
          },
          {
            to: "/operate/reference/treasury-owner",
            from: [
              "/contracts/treasury-owner",
              "/specs/provable/treasury-owner",
            ],
          },
          {
            to: "/operate/reference/treasury-proposal",
            from: [
              "/contracts/treasury-proposal",
              "/specs/provable/treasury-proposal",
            ],
          },
          {
            to: "/operate/reference/pause-controller",
            from: [
              "/contracts/pause-controller",
              "/specs/provable/treasury-pause-controller",
            ],
          },
          {
            to: "/operate/reference/staking-ledger-to-voting-ledger",
            from: [
              "/contracts/proof-relations",
              "/specs/provable/staking-ledger-to-voting-ledger",
            ],
          },
          {
            to: "/operate/reference/vote-reducer",
            from: ["/specs/provable/vote-reducer"],
          },
          {
            to: "/operate/reference/constants-and-acceptance",
            from: ["/specs/provable/provable-primitives"],
          },
          {
            to: "/operate/reference/developer-reference",
            from: [
              "/developer",
              "/developer/contributing",
              "/developer/testing",
              "/developer/apps/backoffice",
              "/developer/apps/web-app",
              "/developer/local-development/local-blockchain",
              "/developer/provable/provable-architecture",
              "/developer/provable/provable-overview",
              "/developer/reference/env-and-commands",
              "/developer/reference/packages",
            ],
          },
          {
            to: "/operate/architecture/authority-and-trust",
            from: [
              "/assurance/control-gates",
              "/assurance/risk-register",
              "/known-issues",
              "/security",
              "/security/threat-model",
            ],
          },
        ],
      },
    ],
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        docsRouteBasePath: "/",
      },
    ],
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          breadcrumbs: true,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Options,
    ],
  ],
  themeConfig: {
    image: "og.png",
    metadata: [
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "theme-color",
        content: "#ff5738",
      },
    ],
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Mina Treasury",
      items: [
        {
          type: "docSidebar",
          sidebarId: "userSidebar",
          label: "Learn",
          position: "left",
        },
        {
          type: "docSidebar",
          sidebarId: "operatorSidebar",
          label: "Operate",
          position: "left",
        },
        {
          href: process.env.TREASURY_APP_URL ?? "http://127.0.0.1:3100",
          label: "Open Treasury",
          position: "right",
          className: "navbar__treasury-app-link",
        },
        {
          href: "https://github.com/MinaFoundation/decentralised-treasury",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Learn",
          items: [
            { label: "Treasury introduction", to: "/learn/" },
            { label: "How it works", to: "/learn/how-it-works" },
            { label: "Lifecycle", to: "/learn/lifecycle-and-snapshots" },
          ],
        },
        {
          title: "Operate",
          items: [
            { label: "Operator overview", to: "/operate/" },
            {
              label: "Configure the Treasury",
              to: "/operate/lifecycle/configure-the-treasury",
            },
            {
              label: "Deploy the Treasury",
              to: "/operate/deployment/deploy-the-treasury",
            },
            {
              label: "Infrastructure runbooks",
              to: "/operate/infrastructure/",
            },
            {
              label: "Ideal lifecycle operation",
              to: "/operate/lifecycle/ideal-lifecycle",
            },
            { label: "Failures and remedies", to: "/operate/failures/" },
            { label: "Technical reference", to: "/operate/reference/" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Mina Foundation.`,
    },
    prism: {
      additionalLanguages: ["bash", "json", "yaml"],
    },
  } satisfies ThemeConfig,
};

export default config;
