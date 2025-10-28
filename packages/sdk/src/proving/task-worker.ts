import * as zmq from "zeromq";
import { SerializedTask, Task } from "./task-queue.js";
import { Provable } from "o1js";

export class TaskWorker {
  public sock = new zmq.Reply();

  public constructor(
    public port: number,
    public tasks: Record<string, Task<any, any> | undefined>
  ) {
    const host = process.env.DT_TASK_QUEUE_HOST || "localhost";
    console.log("worker connecting to", `tcp://${host}:${port}`);
    this.sock.connect(`tcp://${host}:${port}`);
  }

  public async start() {
    console.log("starting task worker");
    for await (const [msg] of this.sock) {
      console.log("received message");
      let task: SerializedTask = JSON.parse(msg.toString());

      console.log("received task", task);

      const runner = this.tasks[task.name];
      if (!runner) {
        throw new Error(`Task runner for${task.name} not found`);
      }

      console.log("deserializing input", task.input);
      const input = await runner.deserializers.input(task.input);
      console.log("deserialized input", input);

      await new Promise((resolve) => setTimeout(resolve, 3000));
      console.log("running task", task.id);
      const result = await runner.run(input);
      console.log("result", result);
      console.log("done working task", task.id);
      const serializedTaskResult: SerializedTask = {
        ...task,
        // status,
        output: await runner.serializers.output(result),
      };
      await this.sock.send(JSON.stringify(serializedTaskResult));
    }
  }
}
