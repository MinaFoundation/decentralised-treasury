import { createArchiveHttpServer } from "./archive/archive-http-server.js";
import { createLocalBlockchainHttpServer } from "./http/local-blockchain-http-server.js";

function readPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const port = readPort(process.env.MINA_NODE_PORT, 8180);
const host = process.env.MINA_NODE_HOST ?? "127.0.0.1";
const proofsEnabled = process.env.PROOFS_ENABLED === "true";
const archivePortRaw = process.env.MINA_ARCHIVE_PORT;
const baseUrl = `http://${host}:${port}`;
const archivePort =
  archivePortRaw && Number.isFinite(Number.parseInt(archivePortRaw, 10))
    ? Number.parseInt(archivePortRaw, 10)
    : null;
const archiveBaseUrl = archivePort === null ? null : `http://${host}:${archivePort}`;

const server = await createLocalBlockchainHttpServer({
  host,
  port,
  proofsEnabled,
});
const archiveServer =
  archivePort !== null
    ? createArchiveHttpServer({
        host,
        port: archivePort,
        runtime: server.runtime,
      })
    : null;

await server.start();
if (archiveServer) {
  await archiveServer.start();
}
console.log("[local-blockchain] ready");
console.log(`[local-blockchain] base url: ${baseUrl}`);
console.log(`[local-blockchain] graphql url: ${baseUrl}/graphql`);
console.log(`[local-blockchain] admin ui: ${baseUrl}/admin`);
console.log(`[local-blockchain] admin state: ${baseUrl}/admin/state`);
console.log(`[local-blockchain] health: ${baseUrl}/healthz`);
if (archiveBaseUrl) {
  console.log(`[local-blockchain] archive url: ${archiveBaseUrl}`);
  console.log(`[local-blockchain] archive graphql url: ${archiveBaseUrl}/graphql`);
}
console.log(`[local-blockchain] proofs enabled: ${String(proofsEnabled)}`);
console.log(`[local-blockchain] network id: ${server.runtime.getNetworkId()}`);
console.log(`[local-blockchain] MINA_NODE_URL=${baseUrl}/graphql`);
if (archiveBaseUrl) {
  console.log(`[local-blockchain] ARCHIVE_NODE_URL=${archiveBaseUrl}/graphql`);
}

async function shutdown() {
  await archiveServer?.stop().catch(() => null);
  await server.stop().catch(() => null);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
