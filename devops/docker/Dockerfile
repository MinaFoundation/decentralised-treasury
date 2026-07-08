FROM node:24.6.0-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_NO_WARNINGS=1
ENV REDISMS_DISABLE_POSTINSTALL=true

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

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/indexer/package.json packages/indexer/package.json
COPY packages/local-blockchain/package.json packages/local-blockchain/package.json
COPY packages/processor/package.json packages/processor/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN chown -R node:node /app /pnpm

EXPOSE 3100 4000 4001 4002 4003 8080 8282

USER node
