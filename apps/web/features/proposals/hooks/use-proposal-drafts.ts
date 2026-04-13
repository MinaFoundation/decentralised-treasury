"use client";

import { useEffect, useMemo, useState } from "react";
import type { TreasuryWalletHeaderDraftProposal } from "@repo/ui/treasury-header";
import type { TreasuryProposalCreationDraft } from "@repo/ui/treasury-proposal-creation-form";
import {
  getProposalDraft,
  PROPOSAL_DRAFTS_CHANGED_EVENT,
  readProposalDrafts,
  removeProposalDraft,
  saveProposalDraft,
  type SavedProposalDraft,
} from "../lib/proposal-drafts";

function formatDraftUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

function extractDraftTitle(contents: string): string {
  const match = contents.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/);
  return match?.[1]?.trim() || "Untitled draft proposal";
}

export function useProposalDrafts() {
  const [drafts, setDrafts] = useState<SavedProposalDraft[]>([]);

  useEffect(() => {
    const sync = () => {
      setDrafts(readProposalDrafts());
    };

    sync();
    window.addEventListener(PROPOSAL_DRAFTS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PROPOSAL_DRAFTS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const headerDraftProposals = useMemo<TreasuryWalletHeaderDraftProposal[]>(
    () =>
      drafts.map((entry) => ({
        id: entry.id,
        title: extractDraftTitle(entry.draft.content),
        lifecycleId: entry.draft.lifecycleId,
        updatedAt: formatDraftUpdatedAt(entry.updatedAt),
      })),
    [drafts],
  );

  return {
    drafts,
    headerDraftProposals,
    getDraftById: (draftId: string) => getProposalDraft(draftId),
    saveDraft: (draft: TreasuryProposalCreationDraft, draftId?: string) =>
      saveProposalDraft(draft, draftId),
    removeDraft: (draftId: string) => removeProposalDraft(draftId),
  };
}
