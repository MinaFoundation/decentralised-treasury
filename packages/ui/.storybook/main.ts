import path from "node:path";
import type { StorybookConfig } from "@storybook/react-webpack5";

const ownSrcGlob = path.join(__dirname, "../src/**/*.{ts,tsx}");

const config: StorybookConfig = {
  stories: [
    "../src/**/*.stories.@(ts|tsx)",
    "../../../apps/backoffice/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-webpack5",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  // Keep TypeScript type-checking enabled in Storybook, with `tsc`
  // still enforced in prestorybook scripts.
  typescript: {
    check: true,
    checkOptions: {
      issue: {
        include: [{ file: ownSrcGlob }],
      },
    },
    reactDocgen: "react-docgen-typescript",
  },
  webpackFinal: async (baseConfig) => {
    const existingRules = baseConfig.module?.rules ?? [];
    for (const rule of existingRules as Array<{
      test?: unknown;
      use?: unknown;
    }>) {
      if (!(rule.test instanceof RegExp) || !rule.test.test("styles.css")) {
        continue;
      }

      if (!Array.isArray(rule.use)) {
        continue;
      }

      const hasPostCssLoader = rule.use.some((loader) => {
        if (typeof loader === "string") {
          return loader.includes("postcss-loader");
        }

        if (
          typeof loader === "object" &&
          loader !== null &&
          "loader" in loader
        ) {
          const loaderName = (loader as { loader?: unknown }).loader;
          return (
            typeof loaderName === "string" &&
            loaderName.includes("postcss-loader")
          );
        }

        return false;
      });

      if (hasPostCssLoader) {
        continue;
      }

      const cssLoaderIndex = rule.use.findIndex((loader) => {
        if (typeof loader === "string") {
          return loader.includes("css-loader");
        }

        if (
          typeof loader === "object" &&
          loader !== null &&
          "loader" in loader
        ) {
          const loaderName = (loader as { loader?: unknown }).loader;
          return (
            typeof loaderName === "string" && loaderName.includes("css-loader")
          );
        }

        return false;
      });

      if (cssLoaderIndex >= 0) {
        rule.use.splice(cssLoaderIndex + 1, 0, "postcss-loader");
      }
    }

    baseConfig.module = {
      ...(baseConfig.module ?? {}),
      rules: [
        ...existingRules,
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
              options: {
                transpileOnly: true,
              },
            },
          ],
        },
      ],
    };

    baseConfig.resolve = {
      ...(baseConfig.resolve ?? {}),
      extensionAlias: {
        ...(baseConfig.resolve?.extensionAlias ?? {}),
        ".js": [".js", ".ts"],
        ".mjs": [".mjs", ".mts"],
        ".cjs": [".cjs", ".cts"],
      },
      extensions: [...(baseConfig.resolve?.extensions ?? []), ".ts", ".tsx"],
    };

    return baseConfig;
  },
};

export default config;
