import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "Mina Decentralized Treasury",
  tagline: "User and developer documentation for the Mina treasury system.",
  favicon: "img/favicon.svg",

  url: "https://mina-foundation.github.io",
  baseUrl: "/decentralized-treasury/",

  organizationName: "mina-foundation",
  projectName: "decentralized-treasury",

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          path: "docs",
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],

  themeConfig: {
    image: "img/social-card.svg",
    navbar: {
      title: "Mina Treasury Docs",
      logo: {
        alt: "Mina Treasury",
        src: "img/favicon.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "userSidebar",
          position: "left",
          label: "User Guide",
        },
        {
          type: "docSidebar",
          sidebarId: "developerSidebar",
          position: "left",
          label: "Developer Guide",
        },
        {
          type: "docSidebar",
          sidebarId: "specsSidebar",
          position: "left",
          label: "Specifications",
        },
        {
          href: "https://github.com/MinaFoundation/decentralized-treasury",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Documentation Home",
              to: "/docs",
            },
          ],
        },
        {
          title: "Repository",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/MinaFoundation/decentralized-treasury",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Mina Foundation.`,
    },
    colorMode: {
      defaultMode: "light",
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    prism: {
      theme: prismThemes.github,
    },
  },
};

export default config;
