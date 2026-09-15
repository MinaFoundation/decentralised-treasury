import type { Config } from "@docusaurus/types";
import type { Options, ThemeConfig } from "@docusaurus/preset-classic";

const treasuryAppUrl = process.env.TREASURY_APP_URL ?? "http://127.0.0.1:3100";
const treasuryAppLabel = "Open Treasury";

const config: Config = {
  title: "Mina Decentralized Treasury",
  tagline: "User, operator, and developer documentation",
  url: process.env.DOCS_URL ?? "https://minafoundation.github.io",
  baseUrl: process.env.DOCS_BASE_URL ?? "/decentralised-treasury/",
  customFields: {
    treasuryAppUrl,
    treasuryAppLabel,
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
    function treasuryTypography() {
      return {
        name: "treasury-typography",
        configurePostCss(options) {
          // Keep the shared app font stack intact instead of adding fallbacks.
          for (const plugin of options.plugins) {
            if (
              Array.isArray(plugin) &&
              String(plugin[0]).includes("postcss-preset-env")
            ) {
              plugin[1] = {
                ...plugin[1],
                features: {
                  ...plugin[1]?.features,
                  "system-ui-font-family": false,
                },
              };
            }
          }
          return options;
        },
      };
    },
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
            from: ["/system"],
          },
          {
            to: "/operate/lifecycle/configure-the-treasury",
            from: ["/environment-creation"],
          },
          {
            to: "/operate/deployment/deploy-the-treasury",
            from: [
              "/runbooks/deployment-upgrade-capacity",
              "/runbooks/backup-and-restore",
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
            to: "/operate/proving/ledgers-and-proving",
            from: ["/runbooks/proof-operations"],
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
            from: ["/failures"],
          },
          {
            to: "/operate/services/",
            from: ["/runbooks/service-operations"],
          },
          {
            to: "/operate/reference/",
            from: ["/contracts", "/specs"],
          },
          {
            to: "/developer/reference/packages",
            from: ["/operate/reference/developer-reference"],
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
        content: "#ff613d",
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
          type: "docSidebar",
          sidebarId: "developerSidebar",
          label: "Develop",
          position: "left",
        },
        {
          href: treasuryAppUrl,
          label: treasuryAppLabel,
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
      style: "light",
      links: [
        {
          title: "Learn",
          items: [
            { label: "Choose a learning path", to: "/learn/" },
            { label: "Treasury overview", to: "/learn/overview" },
            { label: "User quickstart", to: "/learn/quickstart" },
            { label: "How it works", to: "/learn/how-it-works" },
          ],
        },
        {
          title: "Operate",
          items: [
            { label: "Choose an operator path", to: "/operate/" },
            { label: "Operator overview", to: "/operate/overview" },
            { label: "Operator quickstart", to: "/operate/quickstart" },
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
        {
          title: "Develop",
          items: [
            { label: "Choose a developer path", to: "/developer/" },
            { label: "Developer overview", to: "/developer/overview" },
            {
              label: "Local development quickstart",
              to: "/developer/local-development/quickstart",
            },
            {
              label: "Full local blockchain demo",
              to: "/developer/local-development/full-local-demo",
            },
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
