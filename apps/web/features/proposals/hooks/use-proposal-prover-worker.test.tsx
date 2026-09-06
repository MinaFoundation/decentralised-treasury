import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProposalProverWorker } from "./use-proposal-prover-worker";

vi.mock("../../runtime-config/lib/get-runtime-config", () => ({
  getRuntimeConfig: () => ({}),
}));

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    MockWorker.instances.push(this);
  }
}

describe("useProposalProverWorker", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("terminates and recreates the worker when a request is aborted", async () => {
    const { result } = renderHook(() => useProposalProverWorker(true));
    const controller = new AbortController();
    let compilePromise: ReturnType<typeof result.current.compile> | undefined;

    act(() => {
      compilePromise = result.current.compile(controller.signal);
    });

    expect(MockWorker.instances).toHaveLength(1);
    expect(MockWorker.instances[0]?.postMessage).toHaveBeenCalledOnce();

    controller.abort();

    await expect(compilePromise).rejects.toMatchObject({ name: "AbortError" });
    expect(MockWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(2));
  });
});
