import { Worker } from "../../src/proving/worker.js";
import { fileURLToPath } from "node:url";

const queueName = process.argv[2];
const redisHost = process.argv[3];
const redisPort = process.argv[4];
const connection = {
  host: redisHost,
  port: parseInt(redisPort),
  maxRetriesPerRequest: null,
};

const worker = new Worker(
  queueName,
  connection,
  fileURLToPath(new URL("./test-queue.js", import.meta.url)),
);
console.log("starting worker", queueName, connection);
await worker.start();
