import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ["dist/**", "build/**", "storybook-static/**"],
  },
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@radix-ui/*"],
              message:
                "Import UI from src/components/ui/* (shadcn wrappers with tailwindcss-animate). Do not import @radix-ui outside that folder.",
            },
          ],
        },
      ],
    },
  },
];
