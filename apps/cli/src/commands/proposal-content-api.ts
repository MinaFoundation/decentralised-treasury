import { setTimeout as delay } from "node:timers/promises";

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
    (payload as { error?: unknown }).error === PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR
  );
}

export async function submitProposalContents({
  apiUrl,
  proposalPublicKey,
  contents,
  timeoutMs = DEFAULT_SUBMISSION_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: SubmitProposalContentsOptions): Promise<SubmitProposalContentsResponse> {
  // Resolve against the base *including* its path. A leading slash here would
  // make the URL root-relative and silently discard any prefix, so an api-url
  // of https://host/api would POST to https://host/proposals/... - which, behind
  // a path-stripping proxy, lands on the web app and returns an HTML 404 the
  // retry loop cannot recognise. The trailing slash keeps the last path segment
  // from being replaced.
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const endpoint = new URL(
    `proposals/${encodeURIComponent(proposalPublicKey)}/content`,
    base,
  );
  const deadline = Date.now() + timeoutMs;
  let lastErrorMessage = "Proposal content submission failed.";

  while (Date.now() <= deadline) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
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
      await delay(retryDelayMs);
      continue;
    }

    const detail =
      typeof payload === "string" ? payload : payload ? JSON.stringify(payload) : response.statusText;
    throw new Error(
      `Failed to submit proposal contents: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }

  throw new Error(
    `Timed out submitting proposal contents for ${proposalPublicKey}: ${lastErrorMessage}`,
  );
}
