import { ChildProcess, spawn } from "child_process";
import * as zmq from "zeromq";

export enum TaskStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
}

export interface Task {
  id: number;
  name: string;
  run: () => Promise<void>;
  serializers: {
    input: () => void;
    output: () => void;
  };
  status: TaskStatus;
  result?: unknown;
}

export class TaskQueue {
  public tasks: Task[] = [];
  public onTaskComplete: (task: Task) => Promise<void> = async () => {};
  public workers: {
    process: ChildProcess;
    isBusy: boolean;
    sock: zmq.Request;
  }[] = [];

  public constructor(public maxConcurrentTasks: number) {}

  public close() {
    for (const worker of this.workers) {
      worker.sock.close();
    }
  }

  public async addTask(task: Task) {
    this.tasks.push(task);
  }

  public async waitUntilEmpty() {
    while (this.tasks.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  public async killWorkers() {
    for (const worker of this.workers) {
      worker.process.kill();
    }
  }

  public async workTasks() {
    for (const worker of this.workers) {
      if (!worker.isBusy && this.tasks.length > 0) {
        worker.isBusy = true;
        const task = this.tasks.find((t) => t.status === TaskStatus.PENDING);

        if (task) {
          task.status = TaskStatus.RUNNING;
          await worker.sock.send(JSON.stringify(task));
          worker.sock.receive().then(async ([msg]) => {
            worker.isBusy = false;
            task.result = JSON.parse(msg.toString());
            task.status = TaskStatus.COMPLETED;
            await this.onTaskComplete(task);
            this.tasks = this.tasks.filter((t) => t.id !== task.id);
            // continue working tasks, assuming a worker freed up
            this.workTasks();
          });
        }
      }
    }
  }

  public async setupWorkers(fromWorkerFile: string) {
    for (let i = 0; i < this.maxConcurrentTasks; i++) {
      console.log("spawning worker", i);
      const sock = new zmq.Request();
      sock.bindSync(`tcp://localhost:${5554 + i}`);
      console.log("sock bound", i, `tcp://localhost:${5554 + i}`);

      const childProcess = spawn(
        "node",
        ["--loader", "ts-node/esm", fromWorkerFile, i.toString()],
        {
          stdio: "inherit",
        }
      );

      this.workers.push({
        process: childProcess,
        isBusy: false,
        sock,
      });
    }
  }
}
