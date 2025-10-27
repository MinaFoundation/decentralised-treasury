import { it } from "node:test";
import { Task, TaskStatus } from "../../src/proving/task-queue.js";
import { WaitTask } from "./wait-task.js";
import { DockerTaskQueue } from "../../src/proving/docker-task-queue.js";

it("should complete a task queue roundtrip", async () => {
  const taskQueue = new DockerTaskQueue(5);

  await WaitTask.prepare();

  await taskQueue.addTask(new WaitTask(0));
  await taskQueue.addTask(new WaitTask(1));
  await taskQueue.addTask(new WaitTask(2));
  await taskQueue.addTask(new WaitTask(3));
  await taskQueue.addTask(new WaitTask(4));

  const workerFile =
    `${process.cwd()}/test/proving/executable/test-task-worker.ts`.slice(1);
  console.log("setting up workers", workerFile);
  await taskQueue.setupWorkers(workerFile);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  taskQueue.onTaskComplete = async (task) => {
    console.log("task completed", task.id, task.result);
  };

  console.log("working tasks");
  await taskQueue.workTasks();

  console.log("waiting until empty");
  await taskQueue.waitUntilEmpty();

  await taskQueue.killWorkers();
});
