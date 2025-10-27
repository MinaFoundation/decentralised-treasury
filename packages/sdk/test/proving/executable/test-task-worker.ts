import { WaitTask } from "../wait-task.js";
import { TaskWorker } from "../../../src/proving/task-worker.js";

const tasks = {
  wait: new WaitTask(0),
};

const taskWorker = new TaskWorker(parseInt(process.argv[2]), tasks);
await taskWorker.start();
