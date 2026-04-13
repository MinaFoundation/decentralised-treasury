"use client";

import type { TreasuryProposalCreationDraft } from "@repo/ui/treasury-proposal-creation-form";

const PROPOSAL_DRAFTS_STORAGE_KEY = "treasury-proposal-drafts";
export const PROPOSAL_DRAFTS_CHANGED_EVENT = "treasury-proposal-drafts-changed";

export interface SavedProposalDraft {
  id: string;
  updatedAt: string;
  draft: TreasuryProposalCreationDraft;
}

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function dispatchProposalDraftsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(PROPOSAL_DRAFTS_CHANGED_EVENT));
}

export function readProposalDrafts(): SavedProposalDraft[] {
  if (!canUseBrowserStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(PROPOSAL_DRAFTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SavedProposalDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProposalDrafts(nextDrafts: SavedProposalDraft[]): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.setItem(PROPOSAL_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts));
  dispatchProposalDraftsChanged();
}

export function saveProposalDraft(
  draft: TreasuryProposalCreationDraft,
  draftId?: string,
): SavedProposalDraft {
  const current = readProposalDrafts();
  const id = draftId ?? `draft-${crypto.randomUUID()}`;
  const nextDraft: SavedProposalDraft = {
    id,
    updatedAt: new Date().toISOString(),
    draft,
  };
  const existingIndex = current.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) {
    const next = [...current];
    next[existingIndex] = nextDraft;
    writeProposalDrafts(next);
    return nextDraft;
  }
  writeProposalDrafts([nextDraft, ...current]);
  return nextDraft;
}

export function removeProposalDraft(draftId: string): void {
  const current = readProposalDrafts();
  writeProposalDrafts(current.filter((entry) => entry.id !== draftId));
}

export function getProposalDraft(draftId: string): SavedProposalDraft | null {
  return readProposalDrafts().find((entry) => entry.id === draftId) ?? null;
}
