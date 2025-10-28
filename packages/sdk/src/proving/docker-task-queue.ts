import { spawn } from "node:child_process";
import { TaskQueue } from "./task-queue.js";
import * as zmq from "zeromq";
import { DockerClient } from "@docker/node-sdk";

const PROOFS_ENABLED = process.env.PROOFS_ENABLED === "true";
export class DockerTaskQueue extends TaskQueue {
  public static image = "decentralized-treasury-worker:latest";
  public static dockerMaxNanoCpus = 4 * 10 ** 9;
  public static dockerMaxMemory = 6 * 10 ** 9; // 6GB
  public docker: DockerClient;
  public containerIds: string[] = [];

  public async setupWorkers(fromWorkerFile: string) {
    this.docker = await DockerClient.fromDockerConfig();
    console.log("pulling image");
    await this.docker.imageCreate(() => {}, {
      fromImage: DockerTaskQueue.image,
    });
    console.log("image pulled");

    for (let i = 0; i < this.maxConcurrentTasks; i++) {
      const sock = new zmq.Request();
      const port = 5554 + i;
      sock.bindSync(`tcp://localhost:${port}`);
      console.log("sock bound", i, `tcp://localhost:${port}`);

      await this.docker.containerDelete(`decentralized-treasury-worker-${i}`, {
        force: true,
      });

      const response = await this.docker.containerCreate(
        {
          Env: [
            "DT_TASK_QUEUE_HOST=host.docker.internal",
            PROOFS_ENABLED ? "PROOFS_ENABLED=true" : "PROOFS_ENABLED=false",
          ],
          WorkingDir: `/app`,
          Image: DockerTaskQueue.image,
          Cmd: [
            "node",
            "--loader",
            "ts-node/esm",
            fromWorkerFile,
            port.toString(),
          ],
          HostConfig: {
            Binds: [`${process.cwd()}:/app/${process.cwd()}:delegated`],
            NanoCpus: DockerTaskQueue.dockerMaxNanoCpus,
            Memory: DockerTaskQueue.dockerMaxMemory,
          },
        },
        {
          name: `decentralized-treasury-worker-${i}`,
        }
      );

      await this.docker.containerStart(response.Id);
      console.log("container started", response);
      this.containerIds.push(response.Id);

      this.workers.push({
        process: {} as any,
        isBusy: false,
        sock,
      });
    }
  }

  public async killWorkers() {
    for (const containerId of this.containerIds) {
      await this.docker.containerDelete(containerId, { force: true });
    }
  }
}
