import { it } from "node:test";
import { Task, TaskQueue, TaskStatus } from "../../src/proving/task-queue.js";
import { WaitTask } from "./wait-task.js";

it("should complete a task queue roundtrip", async () => {
  const taskQueue = new TaskQueue(1);

  WaitTask.prepare();

  [1000, 1000, 1000, 1000].forEach(async (waitTime) => {
    const task = new WaitTask();
    task.input = waitTime;
    await taskQueue.addTask(task);
  });

  const workerFile = `${process.cwd()}/test/proving/executable/test-task-worker.ts`;
  console.log("setting up workers", workerFile);
  await taskQueue.setupWorkers(workerFile);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  taskQueue.onTaskComplete = async (task) => {
    console.log("task completed", task.id, task.output);
  };

  console.log("working tasks");
  await taskQueue.workTasks();

  console.log("waiting until empty");
  await taskQueue.waitUntilEmpty();

  await taskQueue.killWorkers();
});
