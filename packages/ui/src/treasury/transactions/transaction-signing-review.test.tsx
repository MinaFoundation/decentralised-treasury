import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  TreasuryTransactionFlowDialog,
  type TreasuryTransactionFlowContext,
} from "./transaction-flow-dialog";

afterEach(cleanup);

const firstReview = {
  wallet: "ledger" as const,
  hash: "0".repeat(60) + "3039",
  accountIndex: 7,
  publicKey: "B62signer",
};

it("updates the active Ledger hash and removes it before inclusion", async () => {
  let context!: TreasuryTransactionFlowContext;
  let finish!: (value: { hash: string }) => void;
  const send = vi.fn((value: TreasuryTransactionFlowContext) => {
    context = value;
    value.onSigningReview?.(firstReview);
    return new Promise<{ hash: string }>((resolve) => {
      finish = resolve;
    });
  });
  render(
    <TreasuryTransactionFlowDialog
      open
      onOpenChange={() => {}}
      kind="vote"
      senderAddress="B62signer"
      onSignAndSend={send}
      onWaitForInclusion={() => new Promise(() => {})}
    />,
  );
  expect(screen.queryByLabelText("Ledger signing hash")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
  await waitFor(() =>
    expect(screen.getByLabelText("Ledger signing hash").textContent).toBe(
      firstReview.hash,
    ),
  );
  const next = { ...firstReview, hash: "0".repeat(63) + "1" };
  act(() => context.onSigningReview?.(next));
  expect(screen.getByLabelText("Ledger signing hash").textContent).toBe(
    next.hash,
  );
  await act(async () => {
    finish({ hash: "submitted-id" });
  });
  expect(screen.queryByLabelText("Ledger signing hash")).toBeNull();
});

it("clears a rejected request before retry and ignores callbacks after cancellation", async () => {
  let context!: TreasuryTransactionFlowContext;
  let reject!: (error: Error) => void;
  const send = vi.fn((value: TreasuryTransactionFlowContext) => {
    context = value;
    value.onSigningReview?.(firstReview);
    return new Promise<{ hash: string }>((_resolve, rejectRequest) => {
      reject = rejectRequest;
    });
  });
  const view = render(
    <TreasuryTransactionFlowDialog
      open
      onOpenChange={() => {}}
      kind="vote"
      senderAddress="B62signer"
      onSignAndSend={send}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
  await screen.findByLabelText("Ledger signing hash");
  await act(async () => {
    reject(new Error("Ledger rejected the request"));
  });
  expect(screen.queryByLabelText("Ledger signing hash")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  await screen.findByLabelText("Ledger signing hash");
  const staleContext = context;
  view.rerender(
    <TreasuryTransactionFlowDialog
      open={false}
      onOpenChange={() => {}}
      kind="vote"
      senderAddress="B62signer"
      onSignAndSend={send}
    />,
  );
  view.rerender(
    <TreasuryTransactionFlowDialog
      open
      onOpenChange={() => {}}
      kind="vote"
      senderAddress="B62signer"
      onSignAndSend={send}
    />,
  );
  act(() => staleContext.onSigningReview?.(firstReview));
  expect(screen.queryByLabelText("Ledger signing hash")).toBeNull();
});

it("does not show a hash for a wallet that sends no Ledger approval events", async () => {
  const send = vi.fn(() => new Promise<void>(() => {}));
  render(
    <TreasuryTransactionFlowDialog
      open
      onOpenChange={() => {}}
      kind="vote"
      senderAddress="B62signer"
      onSignAndSend={send}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText("Ledger signing hash")).toBeNull();
});
