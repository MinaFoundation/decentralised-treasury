import { Command, Option } from "commander";
import { Worker } from "@repo/sdk/src/proving/worker.js";
import { parseIntOption } from "./option-parsers.js";

interface StartWorkerOptions {
  queueName: string;
  redisHost: string;
  redisPort: number;
}

export async function startWorker(options: StartWorkerOptions): Promise<void> {
  const { queueName, redisHost, redisPort } = options;

  const worker = new Worker(queueName, {
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
  });

  await worker.start();

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await new Promise<void>(() => {});
}

export default function workerCommandFactory(program: Command) {
  const command = program.command("worker");

  command
    .command("start")
    .addOption(
      new Option("--queue-name <queue-name>", "Queue name")
        .env("QUEUE_NAME")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--redis-host <redis-host>", "Redis host")
        .env("REDIS_HOST")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--redis-port <redis-port>", "Redis port")
        .env("REDIS_PORT")
        .argParser(parseIntOption)
        .makeOptionMandatory(),
    )
    .action(startWorker);
}
