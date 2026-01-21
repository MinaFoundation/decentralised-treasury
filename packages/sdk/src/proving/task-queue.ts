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

  public async addTask<
    TaskName extends keyof Tasks extends string ? keyof Tasks : never,
    Output extends Awaited<
      ReturnType<Tasks[TaskName]["deserializers"]["output"]>
    >,
  >(
    taskName: TaskName,
    input: Parameters<Tasks[TaskName]["serializers"]["input"]>[0],
    onTaskComplete?: (output: Output) => Promise<void>
  ) {
    const taskConstructor = this.tasks[taskName];
    const serializedInput = await taskConstructor.serializers.input(input);
    const job = await this.queue.add(taskName, serializedInput);
    const result = await this.onTaskComplete<TaskName, Output>(
      taskName,
      job.id
    );
    await onTaskComplete?.(result);
  }

  public onTaskComplete<
    TaskName extends keyof Tasks extends string ? keyof Tasks : never,
    Output extends Awaited<
      ReturnType<Tasks[keyof Tasks]["deserializers"]["output"]>
    >,
  >(taskName: TaskName, jobId: string): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      const listener = async ({ jobId: completedJobId, returnvalue }) => {
        if (jobId !== completedJobId) {
          return;
        }

        try {
          const output = (await this.tasks[taskName].deserializers.output(
            returnvalue
          )) as Output;
          this.events.removeListener("completed", listener);
          resolve(output);
        } catch (e) {
          console.error("error deserializing output", e);
          reject(e);
        }
      };

      this.events.on("completed", listener);
    });
  }

  public async close() {
    await this.events.close();
    await this.queue.close();
  }
}
