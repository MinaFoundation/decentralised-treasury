import { Task } from "./task-queue.js";

interface WorkerJobProcessRunMessage {
  type: "run";
  jobName: string;
  jobData: string;
}

interface WorkerJobProcessReadyMessage {
  type: "ready";
}

interface WorkerJobProcessSuccessMessage {
  type: "success";
  result: string;
}

interface WorkerJobProcessErrorMessage {
  type: "error";
  error: string;
}

interface WorkerJobProcessInitErrorMessage {
  type: "init-error";
  error: string;
}

type WorkerJobProcessOutput =
  | WorkerJobProcessReadyMessage
  | WorkerJobProcessSuccessMessage
  | WorkerJobProcessErrorMessage
  | WorkerJobProcessInitErrorMessage;

function asErrorString(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}

async function loadTasks(modulePath: string): Promise<Record<string, Task<unknown, unknown>>> {
  const module = await import(modulePath);
  const tasks = module.tasks ?? module.default;
  if (!tasks || typeof tasks !== "object") {
    throw new Error(
      `Tasks module "${modulePath}" must export "tasks" or default tasks object`,
    );
  }
  return tasks as Record<string, Task<unknown, unknown>>;
}

function send(message: WorkerJobProcessOutput) {
  if (process.send) {
    process.send(message);
  }
}

const tasksModulePath = process.argv[2];
if (!tasksModulePath) {
  send({
    type: "init-error",
    error: "Missing tasks module path argument for worker-job-process",
  });
  process.exit(1);
}

let tasks: Record<string, Task<unknown, unknown>>;

try {
  tasks = await loadTasks(tasksModulePath);
  for (const task of Object.values(tasks)) {
    await task.prepare();
  }
  send({ type: "ready" });
} catch (error) {
  send({ type: "init-error", error: asErrorString(error) });
  process.exit(1);
}

process.on("message", async (message: WorkerJobProcessRunMessage) => {
  if (!message || message.type !== "run") {
    return;
  }

  const task = tasks[message.jobName];
  if (!task) {
    send({
      type: "error",
      error: `Task definition not found for job ${message.jobName}`,
    });
    return;
  }

  try {
    const input = await task.deserializers.input(message.jobData);
    const result = await task.run(input);
    const serializedResult = await task.serializers.output(result);
    send({
      type: "success",
      result: serializedResult,
    });
  } catch (error) {
    send({
      type: "error",
      error: asErrorString(error),
    });
  }
});
