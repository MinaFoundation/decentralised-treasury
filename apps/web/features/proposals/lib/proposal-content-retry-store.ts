"use client";

const PROPOSAL_CONTENT_RETRY_STORAGE_KEY = "treasury-proposal-content-retries";
export const PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT =
  "treasury-proposal-content-retries-changed";

export interface ProposalContentRetryRecord {
  proposalPublicKey: string;
  zkAppUriHash: string;
  contents: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  transactionHash?: string | null;
}

export interface SaveProposalContentRetryRecordInput {
  proposalPublicKey: string;
  zkAppUriHash: string;
  contents: string;
  transactionHash?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
}

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function dispatchProposalContentRetriesChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT));
}

function isRetryRecord(value: unknown): value is ProposalContentRetryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ProposalContentRetryRecord>;
  return (
    typeof candidate.proposalPublicKey === "string" &&
    candidate.proposalPublicKey.length > 0 &&
    typeof candidate.zkAppUriHash === "string" &&
    candidate.zkAppUriHash.length > 0 &&
    typeof candidate.contents === "string" &&
    candidate.contents.length > 0 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function readProposalContentRetryRecords(): ProposalContentRetryRecord[] {
  if (!canUseBrowserStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(PROPOSAL_CONTENT_RETRY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRetryRecord) : [];
  } catch {
    return [];
  }
}

function writeProposalContentRetryRecords(
  nextRecords: ProposalContentRetryRecord[],
): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.setItem(
    PROPOSAL_CONTENT_RETRY_STORAGE_KEY,
    JSON.stringify(nextRecords),
  );
  dispatchProposalContentRetriesChanged();
}

export function getProposalContentRetryRecord(
  proposalPublicKey: string,
): ProposalContentRetryRecord | null {
  return (
    readProposalContentRetryRecords().find(
      (record) => record.proposalPublicKey === proposalPublicKey,
    ) ?? null
  );
}

export function saveProposalContentRetryRecord(
  input: SaveProposalContentRetryRecordInput,
): ProposalContentRetryRecord {
  const current = readProposalContentRetryRecords();
  const now = new Date().toISOString();
  const existingIndex = current.findIndex(
    (record) => record.proposalPublicKey === input.proposalPublicKey,
  );
  const existing = existingIndex >= 0 ? current[existingIndex] : null;
  const nextRecord: ProposalContentRetryRecord = {
    proposalPublicKey: input.proposalPublicKey,
    zkAppUriHash: input.zkAppUriHash,
    contents: input.contents,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastAttemptAt: input.lastAttemptAt ?? existing?.lastAttemptAt ?? null,
    lastError: input.lastError ?? existing?.lastError ?? null,
    transactionHash: input.transactionHash ?? existing?.transactionHash ?? null,
  };

  if (existingIndex >= 0) {
    const nextRecords = [...current];
    nextRecords[existingIndex] = nextRecord;
    writeProposalContentRetryRecords(nextRecords);
    return nextRecord;
  }

  writeProposalContentRetryRecords([nextRecord, ...current]);
  return nextRecord;
}

export function updateProposalContentRetryRecord(
  proposalPublicKey: string,
  patch: Partial<
    Pick<ProposalContentRetryRecord, "lastAttemptAt" | "lastError" | "transactionHash">
  >,
): ProposalContentRetryRecord | null {
  const current = readProposalContentRetryRecords();
  const existingIndex = current.findIndex(
    (record) => record.proposalPublicKey === proposalPublicKey,
  );
  if (existingIndex < 0) {
    return null;
  }
  const nextRecord: ProposalContentRetryRecord = {
    ...current[existingIndex]!,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const nextRecords = [...current];
  nextRecords[existingIndex] = nextRecord;
  writeProposalContentRetryRecords(nextRecords);
  return nextRecord;
}

export function removeProposalContentRetryRecord(proposalPublicKey: string): void {
  const current = readProposalContentRetryRecords();
  writeProposalContentRetryRecords(
    current.filter((record) => record.proposalPublicKey !== proposalPublicKey),
  );
}
