import { afterEach, describe, expect, it, vi } from "vitest";
import { signZkappWithAuro } from "./auro-wallet-client";

const SENDER = "B62expected";
const transactionJson = (feePayer = SENDER) =>
  JSON.stringify({ feePayer: { body: { publicKey: feePayer } } });

afterEach(() => {
  delete window.mina;
});

describe("Auro wallet client", () => {
  it("rejects a transaction for another fee payer before opening Auro", async () => {
    const requestAccounts = vi.fn();
    const sendTransaction = vi.fn();
    window.mina = { requestAccounts, sendTransaction };

    await expect(
      signZkappWithAuro({
        transactionJson: transactionJson("B62other"),
        expectedSenderAddress: SENDER,
        fee: "0.1",
        memo: "Vote",
      }),
    ).rejects.toThrow(/different fee payer/);
    expect(requestAccounts).not.toHaveBeenCalled();
  });

  it("returns a signed command for the selected account", async () => {
    const signedCommand = { feePayer: { body: { publicKey: SENDER } } };
    const sendTransaction = vi.fn().mockResolvedValue({
      signedData: JSON.stringify({ zkappCommand: signedCommand }),
    });
    window.mina = {
      requestAccounts: vi.fn().mockResolvedValue([SENDER]),
      sendTransaction,
    };

    await expect(
      signZkappWithAuro({
        transactionJson: transactionJson(),
        expectedSenderAddress: SENDER,
        fee: "0.1",
        memo: "Vote",
        nonce: 7,
      }),
    ).resolves.toEqual(signedCommand);
    expect(sendTransaction).toHaveBeenCalledWith({
      onlySign: true,
      transaction: transactionJson(),
      feePayer: { fee: 0.1, memo: "Vote" },
      nonce: 7,
    });
  });
});
