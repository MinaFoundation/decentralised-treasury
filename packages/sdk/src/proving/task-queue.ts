import { Queue, QueueEvents, RedisOptions } from "bullmq";
import { logger } from "../logging/logger.js";

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
  private readonly keepCompleted: number;
  private readonly keepFailed: number;
  public constructor(
    public queueName: string,
    public tasks: Tasks,
    connection: RedisOptions,
  ) {
    this.defaultAttempts = Number(process.env.TASK_ATTEMPTS ?? 5);
    this.defaultBackoffMs = Number(process.env.TASK_BACKOFF_MS ?? 1000);
    this.keepCompleted = Number(process.env.TASK_KEEP_COMPLETED ?? 100);
    this.keepFailed = Number(process.env.TASK_KEEP_FAILED ?? 200);

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: this.defaultAttempts,
        backoff: {
          type: "exponential",
          delay: this.defaultBackoffMs,
        },
        // Finished jobs hold their whole serialized output (proof payloads run
        // to ~145KB), so retaining them without a bound fills the redis volume
        // and eventually wedges the queue on MISCONF. Dropping them is safe:
        // onTaskComplete below resolves from the QueueEvents `completed`
        // payload, never by reading the job back, so no caller needs the hash
        // to survive completion. The counts keep a small tail for debugging.
        removeOnComplete: { count: this.keepCompleted },
        removeOnFail: { count: this.keepFailed },
      },
    });

    this.events = new QueueEvents(queueName, {
      connection,
    });
    // Multiple jobs can be awaited concurrently; avoid listener limit warnings.
    this.events.setMaxListeners(0);
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
          logger.error("error deserializing output", e);
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
