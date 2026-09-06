"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BackofficeRuntimeConfig } from "./runtime-config";
import type {
  ProverRequest,
  ProverRequestInput,
  ProverResponse,
  ProverStatus,
} from "./prover-worker.types";

export function useProverWorker({
  disabled = false,
  config,
}: {
  disabled?: boolean;
  config: BackofficeRuntimeConfig;
}) {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(
    new Map<
      string,
      {
        resolve: (value: ProverResponse) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const [status, setStatus] = useState<ProverStatus>({
    ready: false,
    phase: "idle",
    error: null,
  });

  useEffect(() => {
    if (disabled) return;

    const pendingRequests = pending.current;
    const worker = new Worker(
      new URL("./workers/break-glass.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ProverResponse>) => {
      setStatus(event.data.status);
      const handlers = pending.current.get(event.data.id);
      if (!handlers) return;
      pending.current.delete(event.data.id);
      if (event.data.ok) handlers.resolve(event.data);
      else handlers.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      setStatus({ ready: false, phase: "idle", error: event.message });
    };
    return () => {
      worker.terminate();
      for (const handlers of pendingRequests.values()) {
        handlers.reject(new Error("The proof worker stopped."));
      }
      pendingRequests.clear();
    };
  }, [disabled]);

  const send = useCallback(
    (input: ProverRequestInput): Promise<ProverResponse> => {
      const worker = workerRef.current;
      if (!worker)
        return Promise.reject(new Error("The proof worker is not available."));
      const id = crypto.randomUUID();
      const request = {
        ...input,
        id,
        config,
      } as ProverRequest;
      return new Promise((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        worker.postMessage(request);
      });
    },
    [config],
  );

  return { status, send };
}
