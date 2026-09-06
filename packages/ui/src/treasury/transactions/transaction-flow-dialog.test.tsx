import { useEffect, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreasuryTransactionFlowDialog } from "./transaction-flow-dialog";

afterEach(() => {
  cleanup();
});

describe("TreasuryTransactionFlowDialog", () => {
  it("shows fee, nonce, and memo in transaction details", () => {
    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="createProposal"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        defaultFee="0.2"
        defaultNonce="12"
        defaultMemo="proposal-create"
      />,
    );

    expect(
      (screen.getByLabelText("Fee (MINA)") as HTMLInputElement).value,
    ).toBe("0.2");
    expect((screen.getByLabelText("Nonce") as HTMLInputElement).value).toBe(
      "12",
    );
    expect((screen.getByLabelText("Memo") as HTMLInputElement).value).toBe(
      "proposal-create",
    );
  });

  it("renders a stage-specific compile failure state", async () => {
    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="vote"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        onCompile={async () => {
          throw new Error("Contract compilation failed.");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));

    expect(await screen.findByText("Compilation failed")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("uses provider-neutral guidance while it waits for a signature", async () => {
    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="vote"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        onCompile={async () => {}}
        onProve={async () => {}}
        onSignAndSend={() => new Promise(() => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));

    expect(
      await screen.findByText(
        "Confirm the transaction in your connected wallet to continue.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Auro should now be open/i)).toBeNull();
  });

  it("does not continue a transaction flow after the modal is remounted", async () => {
    let resolveProof: (() => void) | undefined;
    const onSignAndSend = vi.fn();
    const view = render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="vote"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        onProve={() =>
          new Promise<void>((resolve) => {
            resolveProof = resolve;
          })
        }
        onSignAndSend={onSignAndSend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    await waitFor(() => {
      expect(resolveProof).toBeTypeOf("function");
    });

    view.unmount();
    resolveProof?.();
    await Promise.resolve();

    expect(onSignAndSend).not.toHaveBeenCalled();
  });

  it("finishes an in-flight flow with its original callbacks after a rerender", async () => {
    let resolveProof: (() => void) | undefined;
    const originalOnSignAndSend = vi.fn().mockResolvedValue({});
    const updatedOnSignAndSend = vi.fn().mockResolvedValue({});
    const senderAddress =
      "B62qrecipientPassExample111111111111111111111111111111111";
    const view = render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="vote"
        senderAddress={senderAddress}
        onProve={() =>
          new Promise<void>((resolve) => {
            resolveProof = resolve;
          })
        }
        onSignAndSend={originalOnSignAndSend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    await waitFor(() => {
      expect(resolveProof).toBeTypeOf("function");
    });

    view.rerender(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="vote"
        senderAddress={senderAddress}
        onProve={async () => {}}
        onSignAndSend={updatedOnSignAndSend}
      />,
    );

    resolveProof?.();

    await waitFor(() => {
      expect(originalOnSignAndSend).toHaveBeenCalledTimes(1);
    });
    expect(updatedOnSignAndSend).not.toHaveBeenCalled();
  });

  it("aborts active work when the dialog closes", async () => {
    const onOpenChange = vi.fn();
    const onSignAndSend = vi.fn();
    let proofSignal: AbortSignal | undefined;
    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={onOpenChange}
        kind="vote"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        onCompile={async () => {}}
        onProve={(context) =>
          new Promise<void>((_resolve, reject) => {
            proofSignal = context.signal;
            context.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          })
        }
        onSignAndSend={onSignAndSend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    await waitFor(() => {
      expect(proofSignal).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(proofSignal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSignAndSend).not.toHaveBeenCalled();
  });

  it("stops inclusion monitoring when the dialog closes", async () => {
    const onOpenChange = vi.fn();
    let inclusionSignal: AbortSignal | undefined;
    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={onOpenChange}
        kind="executeProposal"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        onCompile={async () => {}}
        onProve={async () => {}}
        onSignAndSend={async () => ({ hash: "5JuHash" })}
        onWaitForInclusion={(context) =>
          new Promise((_resolve, reject) => {
            inclusionSignal = context.signal;
            context.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          })
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    const closeButton = await screen.findByRole("button", {
      name: "Close and stop waiting",
    });
    fireEvent.click(closeButton);

    expect(inclusionSignal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(
      screen.queryByText("Waiting for inclusion in background"),
    ).toBeNull();
  });

  it("waits for proposal content posting before completing create proposal flow", async () => {
    const callOrder: string[] = [];
    const postInclusionResolver: { current: null | (() => void) } = {
      current: null,
    };

    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={() => {}}
        kind="createProposal"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        onCompile={async () => {
          callOrder.push("compile");
        }}
        onProve={async () => {
          callOrder.push("prove");
        }}
        onSignAndSend={async () => {
          callOrder.push("signAndSend");
          return {
            hash: "5JuDcreateHashTest111111111111111111111111111111111111111",
          };
        }}
        onWaitForInclusion={async ({ hash }) => {
          callOrder.push("waitForInclusion");
          return {
            hash,
            blockHeight: 452041,
          };
        }}
        onPostInclusion={async () => {
          callOrder.push("postInclusion");
          await new Promise<void>((resolve) => {
            postInclusionResolver.current = () => {
              callOrder.push("postInclusionResolved");
              resolve();
            };
          });
        }}
        onComplete={() => {
          callOrder.push("complete");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));

    expect(await screen.findByText("Posting proposal content")).toBeTruthy();
    expect(callOrder).toEqual([
      "compile",
      "prove",
      "signAndSend",
      "waitForInclusion",
      "postInclusion",
    ]);

    if (!postInclusionResolver.current) {
      throw new Error("Expected post-inclusion resolver to be available.");
    }

    const releasePostInclusion = postInclusionResolver.current;
    releasePostInclusion();

    await waitFor(() => {
      expect(callOrder).toEqual([
        "compile",
        "prove",
        "signAndSend",
        "waitForInclusion",
        "postInclusion",
        "postInclusionResolved",
        "complete",
      ]);
    });
    expect(await screen.findByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("auto closes after completion when configured", async () => {
    const onOpenChange = vi.fn();
    const onComplete = vi.fn();

    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={onOpenChange}
        kind="executeProposal"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        autoCloseDelaySeconds={1}
        onCompile={async () => {}}
        onProve={async () => {}}
        onSignAndSend={async () => ({
          hash: "5JuDexecuteAutoClose111111111111111111111111111111111111111",
        })}
        onWaitForInclusion={async ({ hash }) => ({
          hash,
          blockHeight: 452044,
        })}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    expect(
      await screen.findByRole("button", { name: "Keep open (1s)" }),
    ).toBeTruthy();

    await waitFor(
      () => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      },
      { timeout: 2000 },
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("lets users keep the modal open after completion", async () => {
    const onOpenChange = vi.fn();
    const onComplete = vi.fn();

    render(
      <TreasuryTransactionFlowDialog
        open
        onOpenChange={onOpenChange}
        kind="vote"
        senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
        autoCloseDelaySeconds={1}
        onCompile={async () => {}}
        onProve={async () => {}}
        onSignAndSend={async () => ({
          hash: "5JuDvoteKeepOpen111111111111111111111111111111111111111",
        })}
        onWaitForInclusion={async ({ hash }) => ({
          hash,
          blockHeight: 452045,
        })}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep open (1s)" }),
    );

    expect(await screen.findByRole("button", { name: "Done" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("still auto closes while parent rerenders frequently", async () => {
    const onDialogClosed = vi.fn();

    render(<RerenderingParentHarness onDialogClosed={onDialogClosed} />);

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));
    expect(
      await screen.findByRole("button", { name: "Keep open (1s)" }),
    ).toBeTruthy();

    await waitFor(
      () => {
        expect(onDialogClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 3500 },
    );
    expect(screen.getByText("dialog closed")).toBeTruthy();
  });
});

function RerenderingParentHarness({
  onDialogClosed,
}: {
  onDialogClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 120);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return open ? (
    <TreasuryTransactionFlowDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          onDialogClosed();
        }
      }}
      kind="vote"
      senderAddress="B62qrecipientPassExample111111111111111111111111111111111"
      autoCloseDelaySeconds={1}
      onCompile={async () => {}}
      onProve={async () => {}}
      onSignAndSend={async () => ({
        hash: "5JuDvoteRerenderClose111111111111111111111111111111111111111",
      })}
      onWaitForInclusion={async ({ hash }) => ({
        hash,
        blockHeight: 452046,
      })}
      onComplete={() => {
        void tick;
      }}
    />
  ) : (
    <span>dialog closed</span>
  );
}
