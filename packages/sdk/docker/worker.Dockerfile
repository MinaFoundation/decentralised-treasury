FROM node:24.6.0-alpine3.22
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

ENV TS_NODE_LOG_ERROR=true

WORKDIR /app
COPY . .
COPY --from=o1js . /app/o1js

RUN pnpm add file:/app/o1js --save-dev
RUN cat package.json
RUN pnpm install
RUN pnpm add -g ts-node
