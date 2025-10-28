import { ChildProcess, spawn } from "child_process";
import * as zmq from "zeromq";

export enum TaskStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
}

export interface TaskSerializers<Input, Output> {
  input: (input: Input) => Promise<string>;
  output: (output: Output) => Promise<string>;
}

export interface TaskDeserializers<Input, Output> {
  input: (input: string) => Promise<Input>;
  output: (output: string) => Promise<Output>;
}
export interface Task<Input, Output> {
  id?: number;
  name: string;
  input: Input;
  run: (input: Input) => Promise<Output>;
  output?: Output;
  status?: TaskStatus;
  serializers: TaskSerializers<Input, Output>;
  deserializers: TaskDeserializers<Input, Output>;
}

export interface SerializedTask {
  id: number;
  name: string;
  input: string;
  output?: string;
}

export class TaskQueue {
  public tasks: Task<unknown, unknown>[] = [];
  public nextTaskId = 1;
  public onTaskComplete: (task: Task<unknown, unknown>) => Promise<void> =
    async () => {};
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

  public async addTask(task: Task<unknown, unknown>) {
    task.status = TaskStatus.PENDING;
    task.id = this.nextTaskId++;
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
        const task = this.tasks[0];

        if (task) {
          this.tasks = this.tasks.filter((t) => t.id !== task.id);

          const serializedTask: SerializedTask = {
            id: task.id,
            name: task.name,
            input: await task.serializers.input(task.input),
          };

          console.log("sending task", serializedTask);
          await worker.sock.send(JSON.stringify(serializedTask));

          worker.sock
            .receive()
            .then(async ([msg]) => {
              let serializedTaskResult: SerializedTask = JSON.parse(
                msg.toString()
              );

              worker.isBusy = false;
              task.output = await task.deserializers.output(
                serializedTaskResult.output
              );

              await this.onTaskComplete(task);

              // continue working tasks, assuming a worker freed up
              this.workTasks();
            })
            .catch((error) => {
              throw error;
            });
        }
      }
    }
  }

  public async setupWorkers(fromWorkerFile: string) {
    for (let i = 0; i < this.maxConcurrentTasks; i++) {
      console.log("spawning worker", i);
      const sock = new zmq.Request();
      const port = 5554 + i;
      sock.bindSync(`tcp://localhost:${port}`);
      console.log("sock bound", i, `tcp://localhost:${port}`);

      const childProcess = spawn(
        "node",
        ["--loader", "ts-node/esm", fromWorkerFile, port.toString()],
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
