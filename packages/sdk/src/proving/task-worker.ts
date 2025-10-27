import * as zmq from "zeromq";
import { Task } from "./task-queue.js";

export class TaskWorker {
  public sock = new zmq.Reply();

  public constructor(
    public id: number,
    public tasks: Record<string, Task | undefined>
  ) {
    const host = process.env.DT_TASK_QUEUE_HOST || "localhost";
    console.log("worker connecting to", `tcp://${host}:${5554 + id}`);
    this.sock.connect(`tcp://${host}:${5554 + id}`);
  }

  public async start() {
    for await (const [msg] of this.sock) {
      const task = JSON.parse(msg.toString()) as Task;

      const runner = this.tasks[task.name];
      if (!runner) {
        throw new Error(`Task runner for${task.name} not found`);
      }

      let result: unknown;
      let status = true;
      let error: unknown;

      console.log("received task", task.id);

      try {
        result = await runner.run();
      } catch (e) {
        error = e;
        status = false;
        result = error;
      }

      console.log("sending result", task.id);
      await this.sock.send(
        JSON.stringify({
          workerId: this.id,
          taskId: task.id,
          status,
          error,
          result,
        })
      );
    }
  }
}
