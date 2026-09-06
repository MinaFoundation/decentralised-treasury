/** @type {import('next').NextConfig} */
import path from "path";
import { fileURLToPath } from "url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const uiSourceDir = path.resolve(appDir, "../../packages/ui/src");
const sdkSourceDir = path.resolve(appDir, "../../packages/sdk/src");
const developmentScriptSource =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(appDir, "../.."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; connect-src 'self' http: https:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${developmentScriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.module = {
      ...(config.module ?? {}),
      rules: [
        {
          test: /\.tsx?$/,
          include: [appDir, uiSourceDir, sdkSourceDir],
          enforce: "pre",
          type: "javascript/auto",
          use: [
            {
              loader: "ts-loader",
              options: {
                transpileOnly: true,
                configFile: path.resolve(appDir, "./tsconfig.json"),
                compilerOptions: {
                  module: "esnext",
                  moduleResolution: "bundler",
                  target: "es2022",
                  jsx: "preserve",
                  experimentalDecorators: true,
                  emitDecoratorMetadata: true,
                  useDefineForClassFields: false,
                },
              },
            },
          ],
        },
        ...(config.module?.rules ?? []),
      ],
    };
    config.resolve = {
      ...(config.resolve ?? {}),
      extensionAlias: {
        ...(config.resolve?.extensionAlias ?? {}),
        ".js": [".js", ".ts"],
        ".jsx": [".jsx", ".tsx"],
        ".mjs": [".mjs", ".mts"],
        ".cjs": [".cjs", ".cts"],
      },
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@repo/sdk": path.resolve(appDir, "../../packages/sdk"),
        "@repo/ui": uiSourceDir,
        fs: path.resolve(appDir, "./shims/fs.ts"),
        "node:fs": path.resolve(appDir, "./shims/fs.ts"),
      },
    };
    return config;
  },
};

export default nextConfig;
