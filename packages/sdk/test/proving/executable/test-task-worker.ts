import { WaitTask } from "../wait-task.js";
import { TaskWorker } from "../../../src/proving/task-worker.js";
import { Task } from "src/proving/task-queue.js";

const tasks: Record<string, Task<any, any>> = {
  wait: new WaitTask(),
};

const port = parseInt(process.argv[2]);
console.log("task worker port", port);
const taskWorker = new TaskWorker(port, tasks);
await taskWorker.start();
