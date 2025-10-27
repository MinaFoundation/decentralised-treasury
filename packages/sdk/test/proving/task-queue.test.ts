import { it } from "node:test";
import { Task, TaskQueue, TaskStatus } from "../../src/proving/task-queue.js";
import { WaitTask } from "./wait-task.js";

it("should complete a task queue roundtrip", async () => {
  const taskQueue = new TaskQueue(1);

  const waitTask = new WaitTask(-1);
  await waitTask.prepare();

  await taskQueue.addTask(new WaitTask(0));
  await taskQueue.addTask(new WaitTask(1));
  await taskQueue.addTask(new WaitTask(2));
  await taskQueue.addTask(new WaitTask(3));
  await taskQueue.addTask(new WaitTask(4));
  await taskQueue.addTask(new WaitTask(5));

  const workerFile = `${process.cwd()}/test/proving/executable/test-task-worker.ts`;
  console.log("setting up workers", workerFile);
  await taskQueue.setupWorkers(workerFile);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("working tasks");
  await taskQueue.workTasks();

  console.log("waiting until empty");
  await taskQueue.waitUntilEmpty();

  await taskQueue.killWorkers();
});
