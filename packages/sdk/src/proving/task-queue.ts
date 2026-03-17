import { Queue, QueueEvents, RedisOptions } from "bullmq";

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
  private readonly defaultAttempts: number;
  private readonly defaultBackoffMs: number;
  public constructor(
    public queueName: string,
    public tasks: Tasks,
    connection: RedisOptions,
  ) {
    this.defaultAttempts = Number(process.env.TASK_ATTEMPTS ?? 5);
    this.defaultBackoffMs = Number(process.env.TASK_BACKOFF_MS ?? 1000);

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: this.defaultAttempts,
        backoff: {
          type: "exponential",
          delay: this.defaultBackoffMs,
        },
      },
    });

    this.events = new QueueEvents(queueName, {
      connection,
    });
  }

  public async obliterate() {
    await this.queue.obliterate({ force: true });
  }

  public async waitUntilEmpty() {
    while (true) {
      const jobCounts = await this.queue.getJobCounts(
        "active",
        "waiting",
        "delayed",
        "prioritized",
        "waiting-children",
      );
      const pendingJobs =
        jobCounts.active +
        jobCounts.waiting +
        jobCounts.delayed +
        jobCounts.prioritized +
        jobCounts["waiting-children"];
      if (pendingJobs === 0) {
        break;
      }
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
    onTaskComplete?: (output: Output) => Promise<void>,
  ) {
    const taskConstructor = this.tasks[taskName];
    const serializedInput = await taskConstructor.serializers.input(input);
    const job = await this.queue.add(taskName, serializedInput);
    const result = await this.onTaskComplete<TaskName, Output>(
      taskName,
      job.id,
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
      const onCompleted = async ({ jobId: completedJobId, returnvalue }) => {
        if (jobId !== completedJobId) {
          return;
        }

        try {
          const output = (await this.tasks[taskName].deserializers.output(
            returnvalue,
          )) as Output;
          cleanup();
          resolve(output);
        } catch (e) {
          console.error("error deserializing output", e);
          cleanup();
          reject(e);
        }
      };

      const onFailed = ({ jobId: failedJobId, failedReason }) => {
        if (jobId !== failedJobId) {
          return;
        }
        cleanup();
        reject(
          new Error(
            `Job ${jobId} failed for task ${String(taskName)}: ${String(failedReason)}`,
          ),
        );
      };

      const cleanup = () => {
        this.events.removeListener("completed", onCompleted);
        this.events.removeListener("failed", onFailed);
      };

      this.events.on("completed", onCompleted);
      this.events.on("failed", onFailed);
    });
  }

  public async close() {
    await this.events.close();
    await this.queue.close();
  }
}
