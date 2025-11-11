import { RedisOptions, Worker as BullMQWorker, Job } from "bullmq";
import { Task } from "./task-queue.js";

export class Worker {
  public worker: BullMQWorker;

  public constructor(
    public queueName: string,
    public tasks: Record<string, Task<unknown, unknown>>,
    public connection: RedisOptions
  ) {
    this.worker = new BullMQWorker(
      queueName,
      async (job) => await this.workJob(job),
      {
        connection,
      }
    );
  }

  public async start() {
    for (const task of Object.values(this.tasks)) {
      await task.prepare();
    }
  }

  public async workJob(job: Job): Promise<string> {
    // console.log("working job", job.id, job.name, job.data);
    const task = this.tasks[job.name as keyof typeof this.tasks];
    if (!task) {
      throw new Error(`Task definition not found for job ${job.name}`);
    }
    const input = await task.deserializers.input(job.data);
    const output = await task.run(input);
    // console.log("worker job completed", job.id, job.name);
    return await task.serializers.output(output);
  }

  public async close() {
    await this.worker.close();
  }
}
