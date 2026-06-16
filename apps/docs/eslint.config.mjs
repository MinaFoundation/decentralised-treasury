import { config as reactConfig } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config} */
export default [
  ...reactConfig,
  {
    ignores: ["build/**", ".docusaurus/**", ".next/**", "docs/**", "node_modules/**"],
  },
];
