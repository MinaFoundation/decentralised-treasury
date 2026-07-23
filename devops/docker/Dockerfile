# syntax=docker/dockerfile:1
FROM node:24.6.0-bookworm-slim AS base

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

# Only the `web` service targets this stage (see devops/compose.yml). Every
# other service targets `base` and never pays for the Next.js build below.
FROM base AS web

RUN mkdir -p apps/web/.next

ARG NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:3100/api
ARG NEXT_PUBLIC_INDEXER_API_URL=http://127.0.0.1:3100/indexer
ARG NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:3100/processor
ARG NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3100/mina/graphql
ARG NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS=B62qpExe8CAaGkR4HRxyXvkziQpE6Aq3U71MJLHivP8pCsiDk1BbU9Z
ARG NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=7140
ARG NEXT_PUBLIC_SLOT_DURATION_MS=180000
ARG NEXT_PUBLIC_PROOFS_ENABLED=false
ARG NEXT_PUBLIC_NETWORK_ID=MAINNET
ARG NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON=
ARG NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON=
ARG NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON=
ARG NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT=
ARG NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT=
ENV NEXT_PUBLIC_TREASURY_API_URL=${NEXT_PUBLIC_TREASURY_API_URL} \
  NEXT_PUBLIC_INDEXER_API_URL=${NEXT_PUBLIC_INDEXER_API_URL} \
  NEXT_PUBLIC_PROCESSOR_API_URL=${NEXT_PUBLIC_PROCESSOR_API_URL} \
  NEXT_PUBLIC_MINA_NODE_URL=${NEXT_PUBLIC_MINA_NODE_URL} \
  NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS=${NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS} \
  NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=${NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION} \
  NEXT_PUBLIC_SLOT_DURATION_MS=${NEXT_PUBLIC_SLOT_DURATION_MS} \
  NEXT_PUBLIC_PROOFS_ENABLED=${NEXT_PUBLIC_PROOFS_ENABLED} \
  NEXT_PUBLIC_NETWORK_ID=${NEXT_PUBLIC_NETWORK_ID} \
  NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON=${NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON} \
  NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON=${NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON} \
  NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON=${NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON} \
  NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT=${NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT} \
  NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT=${NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT}

RUN --mount=type=cache,target=/app/apps/web/.next/cache,uid=1000,gid=1000 \
  pnpm --dir apps/web run build
