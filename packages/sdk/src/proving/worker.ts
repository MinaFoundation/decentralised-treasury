import { RedisOptions, Worker as BullMQWorker, Job } from "bullmq";
import { fork, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logger } from "../logging/logger.js";

interface WorkerJobProcessReadyMessage {
  type: "ready";
}

interface WorkerJobProcessRunMessage {
  type: "run";
  jobName: string;
  jobData: string;
}

interface WorkerJobProcessSuccessMessage {
  type: "success";
  result: string;
}

interface WorkerJobProcessErrorMessage {
  type: "error";
  error: string;
}

interface WorkerJobProcessInitErrorMessage {
  type: "init-error";
  error: string;
}

type WorkerJobProcessParentMessage =
  | WorkerJobProcessReadyMessage
  | WorkerJobProcessSuccessMessage
  | WorkerJobProcessErrorMessage
  | WorkerJobProcessInitErrorMessage;

export class Worker {
  public worker: BullMQWorker;
  private subprocess?: ChildProcess;
  private subprocessReadyPromise?: Promise<void>;
  public static readonly DEFAULT_MAX_TASK_DURATION = Number(
    process.env.MAX_TASK_DURATION_MS ?? 1 * 60 * 1000,
  );

  public constructor(
    public queueName: string,
    public connection: RedisOptions,
    public tasksModulePath: string = fileURLToPath(
      new URL("./tasks/index.js", import.meta.url),
    ),
    public maxTaskDuration: number = Worker.DEFAULT_MAX_TASK_DURATION,
  ) {}

  public async createWorker() {
    this.worker = new BullMQWorker(
      this.queueName,
      async (job) => await this.workJob(job),
      {
        connection: this.connection,
        concurrency: 1,
        // Derived from maxTaskDuration rather than left at BullMQ's 30s
        // default, which is shorter than the 60s a task is already allowed to
        // run for. Proving routinely takes longer than 30s, so every such job
        // outlived its lock: BullMQ declared it stalled and requeued it, a
        // second worker re-proved it, and the first failed on completion with
        // "Missing lock for job <id>". The lock has to outlive the work it
        // protects, so it is deliberately tied to the same number.
        lockDuration: this.maxTaskDuration * 2,
        // A stall now means something genuinely went wrong rather than a job
        // simply taking its allotted time, but one blip should still not send
        // an otherwise healthy proof to the failed set.
        maxStalledCount: 3,
      },
    );
  }

  public async start() {
    logger.info("starting worker", this.queueName);
    await this.ensureSubprocess();

    await this.createWorker();
  }

  // TODO: implement a worker monitor with an endpoint for health metrics
  // will allow docker compose to restart workers if stalled
  public async workJob(job: Job): Promise<string> {
    try {
      await this.ensureSubprocess();
      return await this.runSubprocessJobWithTimeout(job.name, job.data);
    } catch (error) {
      logger.error("error working job", job.id, job.name, error);
      throw error;
    }
  }

  private async ensureSubprocess(): Promise<void> {
    if (
      this.subprocess &&
      this.subprocess.connected &&
      this.subprocessReadyPromise
    ) {
      await this.subprocessReadyPromise;
      return;
    }

    const workerProcessPath = fileURLToPath(
      new URL("./worker-job-process.js", import.meta.url),
    );
    const subprocess = fork(workerProcessPath, [this.tasksModulePath], {
      execArgv: process.execArgv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.subprocess = subprocess;

    this.subprocessReadyPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (message: WorkerJobProcessParentMessage) => {
        if (message.type === "ready") {
          cleanup();
          resolve();
          return;
        }

        if (message.type === "init-error") {
          cleanup();
          reject(new Error(message.error));
          return;
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(
            `Task subprocess exited before ready (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      };

      const cleanup = () => {
        subprocess.off("message", onMessage);
        subprocess.off("error", onError);
        subprocess.off("exit", onExit);
      };

      subprocess.on("message", onMessage);
      subprocess.once("error", onError);
      subprocess.once("exit", onExit);
    });

    this.subprocess.once("exit", () => {
      this.subprocess = undefined;
      this.subprocessReadyPromise = undefined;
    });

    await this.subprocessReadyPromise;
  }

  private async runSubprocessJobWithTimeout(
    jobName: string,
    jobData: string,
  ): Promise<string> {
    const subprocess = this.subprocess;
    if (!subprocess) {
      throw new Error("Task subprocess is not available");
    }

    return await new Promise<string>((resolve, reject) => {
      let completed = false;
      const timeout = setTimeout(() => {
        if (completed) return;
        completed = true;
        this.terminateSubprocess();
        reject(
          new Error(
            `Task exceeded MAX_TASK_DURATION (${this.maxTaskDuration}ms) and was terminated`,
          ),
        );
      }, this.maxTaskDuration);

      const onMessage = (message: WorkerJobProcessParentMessage) => {
        if (completed) return;
        if (message.type !== "success" && message.type !== "error") {
          return;
        }
        completed = true;
        clearTimeout(timeout);
        cleanup();
        if (message.type === "success") {
          resolve(message.result);
          return;
        }
        reject(new Error(message.error));
      };

      const onError = (error: Error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        cleanup();
        this.terminateSubprocess();
        reject(error);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        cleanup();
        this.subprocess = undefined;
        this.subprocessReadyPromise = undefined;
        reject(
          new Error(
            `Task subprocess exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      };

      const cleanup = () => {
        subprocess.off("message", onMessage);
        subprocess.off("error", onError);
        subprocess.off("exit", onExit);
      };

      subprocess.on("message", onMessage);
      subprocess.once("error", onError);
      subprocess.once("exit", onExit);

      const runMessage: WorkerJobProcessRunMessage = {
        type: "run",
        jobName,
        jobData,
      };

      subprocess.send(runMessage);
    });
  }

  private terminateSubprocess() {
    if (!this.subprocess) {
      return;
    }

    this.subprocess.kill("SIGKILL");
    this.subprocess = undefined;
    this.subprocessReadyPromise = undefined;
  }

  public async close() {
    this.terminateSubprocess();
    await this.worker.close();
  }
}
