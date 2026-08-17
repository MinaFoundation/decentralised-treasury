# syntax=docker/dockerfile:1
FROM node:24.6.0-bookworm-slim AS base

ARG BUILD_SHA=unknown

LABEL org.opencontainers.image.revision=$BUILD_SHA

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_NO_WARNINGS=1
ENV REDISMS_DISABLE_POSTINSTALL=true
# Not NEXT_PUBLIC_-prefixed on purpose: the web app resolves the revision from
# this name at runtime, and a NEXT_PUBLIC_ variable present during `next build`
# would be inlined into the client bundle instead.
ENV BUILD_SHA=$BUILD_SHA

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    make \
    g++ \
    python3 \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

RUN mkdir -p /pnpm && chown -R node:node /app /pnpm

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/cli/package.json apps/cli/package.json
COPY --chown=node:node apps/docs/package.json apps/docs/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/eslint-config/package.json packages/eslint-config/package.json
COPY --chown=node:node packages/indexer/package.json packages/indexer/package.json
COPY --chown=node:node packages/local-blockchain/package.json packages/local-blockchain/package.json
COPY --chown=node:node packages/processor/package.json packages/processor/package.json
COPY --chown=node:node packages/sdk/package.json packages/sdk/package.json
COPY --chown=node:node packages/typescript-config/package.json packages/typescript-config/package.json
COPY --chown=node:node packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

EXPOSE 3100 4000 4001 4002 4003 8080 8282

# Compiles the Next.js bundle. Deliberately runs with no NEXT_PUBLIC_* variables
# set: any that were present here would be inlined into the client bundle by
# `next build` and pin the image to a single deployment. The browser instead
# receives its configuration at container start - see
# apps/web/features/runtime-config.
FROM base AS web-build

RUN mkdir -p apps/web/.next

RUN --mount=type=cache,target=/app/apps/web/.next/cache,uid=1000,gid=1000 \
  pnpm --dir apps/web run build

# The published web image: only the traced standalone server, the static assets
# and the public directory. No pnpm workspace, no source tree, no build
# toolchain. Configure it entirely through environment variables at `docker run`
# time (see devops/PUBLISHING.md).
FROM node:24.6.0-bookworm-slim AS web

ARG BUILD_SHA=unknown

LABEL org.opencontainers.image.revision=$BUILD_SHA
LABEL org.opencontainers.image.title="Mina Decentralized Treasury web"
LABEL org.opencontainers.image.description="Runtime-configurable Next.js UI for the Mina decentralized treasury."

ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
ENV BUILD_SHA=$BUILD_SHA
# Read by the Next.js standalone server itself.
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

WORKDIR /app

USER node

# `output: "standalone"` traces from the workspace root, so this lands as
# /app/node_modules plus /app/apps/web/server.js.
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public

EXPOSE 3100

CMD ["node", "apps/web/server.js"]
