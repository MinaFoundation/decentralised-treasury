import { spawn } from "node:child_process";
import { TaskQueue } from "./task-queue.js";
import * as zmq from "zeromq";
import { DockerClient } from "@docker/node-sdk";

export class DockerTaskQueue extends TaskQueue {
  public static image = "decentralized-treasury-worker:latest";
  public static dockerMaxNanoCpus = 10 * 10 ** 9;
  public static dockerMaxMemory = 5 * 10 ** 9; // 5GB
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
      sock.bindSync(`tcp://localhost:${5554 + i}`);
      console.log("sock bound", i, `tcp://localhost:${5554 + i}`);

      await this.docker.containerDelete(`decentralized-treasury-worker-${i}`, {
        force: true,
      });

      const response = await this.docker.containerCreate(
        {
          Env: ["DT_TASK_QUEUE_HOST=host.docker.internal"],
          WorkingDir: `/app`,
          Image: DockerTaskQueue.image,
          Cmd: [
            "node",
            "--loader",
            "ts-node/esm",
            fromWorkerFile,
            i.toString(),
          ],
          HostConfig: {
            Binds: [`${process.cwd()}:/app/${process.cwd()}`],
            NanoCpus: DockerTaskQueue.dockerMaxNanoCpus,
            Memory: DockerTaskQueue.dockerMaxMemory,
          },
        },
        {
          name: `decentralized-treasury-worker-${i}`,
        }
      );

      await this.docker.containerStart(response.Id);
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
