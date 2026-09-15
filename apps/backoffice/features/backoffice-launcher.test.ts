// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import type { TestInfo } from "@playwright/test";
import type { LocalTreasuryStack } from "../../web/e2e/utils/local-treasury-stack";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  waitForUrl: vi.fn(async () => {}),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mocks.spawn,
    default: { ...actual, spawn: mocks.spawn },
  };
});
vi.mock("../../web/e2e/utils/local-treasury-stack", () => ({
  availablePort: async () => 48123,
  waitForUrl: mocks.waitForUrl,
}));
import { createBackofficeLauncher } from "../e2e/utils/backoffice-launcher";

it.each([false, true])(
  "restarts only Backoffice with new public configuration in proof mode %s",
  async (proofsEnabled) => {
    mocks.spawn.mockClear();
    const children: Array<
      EventEmitter & {
        exitCode: number | null;
        signalCode: string | null;
        kill: ReturnType<typeof vi.fn>;
      }
    > = [];
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as string | null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      child.kill.mockImplementation((signal: string) => {
        child.signalCode = signal;
        queueMicrotask(() => child.emit("close", null, signal));
        return true;
      });
      children.push(child);
      return child;
    });
    const stack = {
      proofsEnabled,
      runtimeEnv: {
        NEXT_PUBLIC_MINA_NODE_URL: "http://127.0.0.1:45000/graphql",
      },
      dispose: vi.fn(),
    };
    const info = { attach: vi.fn(async () => {}) };
    const app = await createBackofficeLauncher(
      stack as unknown as LocalTreasuryStack,
      info as unknown as TestInfo,
    );
    await app.start(["old-1", "old-2"]);
    await expect(app.start(["new-1"])).rejects.toThrow(/Stop Backoffice/);
    await app.stop();
    await app.start(["new-1", "new-2"]);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    const first = mocks.spawn.mock.calls[0]![2];
    const second = mocks.spawn.mock.calls[1]![2];
    expect(second.cwd).toBe(first.cwd);
    expect(second.env.NEXT_PUBLIC_MINA_NODE_URL).toBe(
      first.env.NEXT_PUBLIC_MINA_NODE_URL,
    );
    expect(second.env.NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS).toBe(
      "new-1,new-2",
    );
    expect(second.env.PROOFS_ENABLED).toBe(String(proofsEnabled));
    expect(second.env.NEXT_PUBLIC_PROOFS_ENABLED).toBe(String(proofsEnabled));
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(stack.dispose).not.toHaveBeenCalled();
    await app.stop();
    await app.stop();
    expect(children[1]!.kill).toHaveBeenCalledOnce();
    expect(info.attach).toHaveBeenCalledTimes(2);
  },
);
