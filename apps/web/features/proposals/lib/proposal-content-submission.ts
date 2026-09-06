"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

const DEFAULT_SUBMISSION_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR =
  "proposal for submitted contents was not found";

interface SubmitProposalContentsOptions {
  apiUrl: string;
  proposalPublicKey: string;
  contents: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

interface SubmitProposalContentsResponse {
  ok: boolean;
  contentChars: number;
  proposalPublicKey: string;
  zkAppUri: string;
  zkAppUriHash: string;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRetryableContentSubmissionFailure(
  status: number,
  payload: unknown,
): boolean {
  if (status === 503) {
    return true;
  }

  return (
    status === 404 &&
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    (payload as { error?: unknown }).error ===
      PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function submitProposalContents({
  apiUrl,
  proposalPublicKey,
  contents,
  timeoutMs = DEFAULT_SUBMISSION_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  signal,
}: SubmitProposalContentsOptions): Promise<SubmitProposalContentsResponse> {
  const endpoint = resolveEndpointUrl(
    apiUrl,
    `/proposals/${encodeURIComponent(proposalPublicKey)}/content`,
  );
  const deadline = Date.now() + timeoutMs;
  let lastErrorMessage = "Proposal content submission failed.";

  while (Date.now() <= deadline) {
    signal?.throwIfAborted();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      signal,
      body: JSON.stringify({ contents }),
    });
    const payload = await readJsonResponse(response);

    if (response.ok) {
      return payload as SubmitProposalContentsResponse;
    }

    if (isRetryableContentSubmissionFailure(response.status, payload)) {
      lastErrorMessage =
        typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : `Proposal content submission retryable failure: ${response.status}`;
      await sleep(retryDelayMs, signal);
      continue;
    }

    const detail =
      typeof payload === "string"
        ? payload
        : payload
          ? JSON.stringify(payload)
          : response.statusText;
    throw new Error(
      `Failed to submit proposal contents: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }

  throw new Error(
    `Timed out submitting proposal contents for ${proposalPublicKey}: ${lastErrorMessage}`,
  );
}
