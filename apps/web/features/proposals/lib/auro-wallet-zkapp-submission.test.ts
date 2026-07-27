import { afterEach, describe, expect, it, vi } from "vitest";
import { signWithAuroWalletAndSubmitZkapp } from "./auro-wallet-zkapp-submission";

const EXPECTED_SENDER = "B62expected";

function transactionJson(feePayer: string = EXPECTED_SENDER): string {
  return JSON.stringify({
    feePayer: {
      body: {
        publicKey: feePayer,
      },
    },
    accountUpdates: [],
  });
}

afterEach(() => {
  delete window.mina;
  vi.unstubAllGlobals();
});

describe("signWithAuroWalletAndSubmitZkapp", () => {
  it("rejects a transaction prepared for another fee payer", async () => {
    const requestAccounts = vi.fn().mockResolvedValue([EXPECTED_SENDER]);
    const sendTransaction = vi.fn();
    window.mina = { requestAccounts, sendTransaction };

    await expect(
      signWithAuroWalletAndSubmitZkapp(
        "https://mina.example/graphql",
        transactionJson("B62other"),
        EXPECTED_SENDER,
        "0.1",
        "Vote",
        7,
      ),
    ).rejects.toThrow("prepared for a different account");

    expect(requestAccounts).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when Auro has a different account selected", async () => {
    const sendTransaction = vi.fn();
    window.mina = {
      requestAccounts: vi.fn().mockResolvedValue(["B62selected"]),
      sendTransaction,
    };

    await expect(
      signWithAuroWalletAndSubmitZkapp(
        "https://mina.example/graphql",
        transactionJson(),
        EXPECTED_SENDER,
        "0.1",
        "Vote",
        7,
      ),
    ).rejects.toThrow("Auro is currently using B62selected");

    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("signs and submits after validating the selected account", async () => {
    const zkappCommand = {
      feePayer: { body: { publicKey: EXPECTED_SENDER } },
      accountUpdates: [],
    };
    const sendTransaction = vi.fn().mockResolvedValue({
      signedData: JSON.stringify({ zkappCommand }),
    });
    window.mina = {
      requestAccounts: vi.fn().mockResolvedValue([EXPECTED_SENDER]),
      sendTransaction,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          sendZkapp: {
            zkapp: {
              hash: "5JuTransactionHash",
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signWithAuroWalletAndSubmitZkapp(
        "https://mina.example/graphql",
        transactionJson(),
        EXPECTED_SENDER,
        "0.1",
        "Vote",
        7,
      ),
    ).resolves.toBe("5JuTransactionHash");

    expect(sendTransaction).toHaveBeenCalledWith({
      onlySign: true,
      transaction: transactionJson(),
      feePayer: {
        fee: 0.1,
        memo: "Vote",
      },
      nonce: 7,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
