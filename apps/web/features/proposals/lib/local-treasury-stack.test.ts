// @vitest-environment node
import { connect, createServer, type Server } from "node:net";
import { expect, it } from "vitest";
import {
  availablePort,
  parseCliJson,
} from "../../../e2e/utils/local-treasury-stack";

it("reads a complete pretty-printed CLI JSON object", () => {
  const snapshot = {
    stakingEpochDataLedgerHash: "123456789",
    accountCount: 6,
  };
  expect(
    parseCliJson(
      JSON.stringify(snapshot, null, 2) + "\n",
      "stakingEpochDataLedgerHash",
    ),
  ).toEqual(snapshot);
});

it("keeps the last matching JSON line when CLI logs surround records", () => {
  expect(
    parseCliJson(
      'starting\r\n{"count":1}\r\nprogress\r\n{"count":2}\r\nfinished\r\n',
      "count",
    ),
  ).toEqual({ count: 2 });
});

it("preserves the missing-field error for valid JSON without the requested key", () => {
  expect(() =>
    parseCliJson('{\n  "accountCount": 6\n}\n', "stakingEpochDataLedgerHash"),
  ).toThrow(
    "CLI output did not contain JSON field stakingEpochDataLedgerHash.",
  );
});

function listen(server: Server, port = 0, host?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a TCP listener."));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

it("keeps delayed fixture listeners outside outbound ephemeral reuse", async () => {
  const ports = await Promise.all(
    Array.from({ length: 6 }, () => availablePort()),
  );
  expect(new Set(ports).size).toBe(ports.length);
  for (const port of ports) {
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThan(30_000);
  }

  const sink = createServer((socket) => socket.end());
  const listeners = ports.map(() => createServer());
  try {
    const sinkPort = await listen(sink, 0, "127.0.0.1");
    await Promise.all(
      Array.from(
        { length: 32 },
        () =>
          new Promise<void>((resolve, reject) => {
            const socket = connect(sinkPort, "127.0.0.1");
            socket.once("error", reject);
            socket.once("close", () => resolve());
          }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    await Promise.all(
      listeners.map((server, index) => listen(server, ports[index])),
    );
  } finally {
    await Promise.allSettled([
      ...(sink.listening ? [close(sink)] : []),
      ...listeners.filter((server) => server.listening).map(close),
    ]);
  }
});
