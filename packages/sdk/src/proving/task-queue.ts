import { Job, Queue, QueueEvents, RedisOptions } from "bullmq";

export interface Task<Input, Output> {
  serializers: {
    input: (input: Input) => Promise<string>;
    output: (output: Output) => Promise<string>;
  };
  deserializers: {
    input: (input: string) => Promise<Input>;
    output: (output: string) => Promise<Output>;
  };

  prepare(): Promise<void>;
  run(input: Input): Promise<Output>;
}

export class TaskQueue<Tasks extends Record<string, Task<unknown, unknown>>> {
  public queue: Queue;
  public events: QueueEvents;
  public constructor(
    public queueName: string,
    public tasks: Tasks,
    connection: RedisOptions
  ) {
    this.queue = new Queue(queueName, {
      connection,
    });

    this.events = new QueueEvents(queueName, {
      connection,
    });
  }

  public async waitUntilEmpty() {
    while ((await this.queue.count()) > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  public async addTask(
    taskName: keyof Tasks extends string ? keyof Tasks : never,
    input: Parameters<Tasks[keyof Tasks]["serializers"]["input"]>[0]
  ) {
    const taskConstructor = this.tasks[taskName];
    const serializedInput = await taskConstructor.serializers.input(input);
    return await this.queue.add(taskName, serializedInput);
  }

  public onTaskComplete<
    Output extends Awaited<
      ReturnType<Tasks[keyof Tasks]["deserializers"]["output"]>
    >,
  >(
    taskName: keyof Tasks extends string ? keyof Tasks : never,
    callback: (job: Job, output: Output) => void
  ) {
    this.events.on("completed", async ({ jobId, returnvalue }) => {
      const job = await Job.fromId(this.queue, jobId);

      if (job.name == taskName) {
        try {
          // TODO: find a way to adjust typing of the task queue to avoid this cast
          const output = (await this.tasks[taskName].deserializers.output(
            returnvalue
          )) as Output;
          callback(job, output);
        } catch (e) {
          console.error("error deserializing output", e);
        }
      }
    });
  }

  public async close() {
    await this.events.close();
    await this.queue.close();
  }
}
