import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProposalContentRetryRecord,
  PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT,
  readProposalContentRetryRecords,
  removeProposalContentRetryRecord,
  saveProposalContentRetryRecord,
  updateProposalContentRetryRecord,
} from "./proposal-content-retry-store";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("proposal content retry store", () => {
  it("saves and reads retry records by proposal public key", () => {
    const listener = vi.fn();
    window.addEventListener(PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT, listener);

    const record = saveProposalContentRetryRecord({
      proposalPublicKey: "B62qproposal",
      zkAppUriHash: "jxhash",
      contents: "# Proposal\n\nContent",
      transactionHash: "tx-hash",
    });

    expect(record.proposalPublicKey).toBe("B62qproposal");
    expect(record.zkAppUriHash).toBe("jxhash");
    expect(record.contents).toBe("# Proposal\n\nContent");
    expect(record.transactionHash).toBe("tx-hash");
    expect(getProposalContentRetryRecord("B62qproposal")).toEqual(record);
    expect(readProposalContentRetryRecords()).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(PROPOSAL_CONTENT_RETRIES_CHANGED_EVENT, listener);
  });

  it("updates retry metadata and removes recovered records", () => {
    saveProposalContentRetryRecord({
      proposalPublicKey: "B62qproposal",
      zkAppUriHash: "jxhash",
      contents: "# Proposal",
    });

    const updated = updateProposalContentRetryRecord("B62qproposal", {
      lastAttemptAt: "2026-04-10T16:42:00.000Z",
      lastError: "Timed out.",
      transactionHash: "tx-hash",
    });

    expect(updated?.lastAttemptAt).toBe("2026-04-10T16:42:00.000Z");
    expect(updated?.lastError).toBe("Timed out.");
    expect(updated?.transactionHash).toBe("tx-hash");

    removeProposalContentRetryRecord("B62qproposal");
    expect(getProposalContentRetryRecord("B62qproposal")).toBeNull();
  });

  it("ignores corrupted storage payloads", () => {
    window.localStorage.setItem("treasury-proposal-content-retries", "{broken");

    expect(readProposalContentRetryRecords()).toEqual([]);
  });
});
