import { afterEach, describe, expect, it, vi } from "vitest";
import { submitSignedZkappCommand } from "./zkapp-submission";

afterEach(() => vi.unstubAllGlobals());

describe("zkApp submission", () => {
  it("submits a provider-neutral signed command", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: { sendZkapp: { zkapp: { hash: "5JuHash" } } },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const command = { feePayer: { authorization: "signature" } };

    await expect(
      submitSignedZkappCommand("https://mina.example/graphql", command),
    ).resolves.toBe("5JuHash");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).variables.zkappCommandInput).toEqual(
      command,
    );
  });
});
