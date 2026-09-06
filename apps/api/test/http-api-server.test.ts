import assert from "node:assert/strict";
import { createServer, type Server as NetServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { HttpApiServer } from "../src/http-api-server.js";

function listenOnAvailablePort(): Promise<{ port: number; server: NetServer }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve ephemeral port"));
        return;
      }
      resolve({ port: address.port, server });
    });
  });
}

function closeServer(server: NetServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("HttpApiServer", () => {
  const runningServers: HttpApiServer[] = [];
  const portReservations: NetServer[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      runningServers.splice(0).map((server) => server.stop()),
    );
    await Promise.allSettled(
      portReservations.splice(0).map((server) => closeServer(server)),
    );
  });

  it("serves liveness and reports dependency readiness truthfully", async () => {
    const reservation = await listenOnAvailablePort();
    await closeServer(reservation.server);
    let ready = false;
    const server = new HttpApiServer({
      name: "health-test",
      port: reservation.port,
      checkReady: () => {
        if (!ready) {
          throw new Error("database unavailable");
        }
      },
    });
    runningServers.push(server);
    await server.start();

    const healthResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/healthz`,
    );
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { ok: true });

    const unavailableResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/readyz`,
    );
    assert.equal(unavailableResponse.status, 503);
    assert.deepEqual(await unavailableResponse.json(), {
      ok: false,
      error: "Service unavailable",
    });

    ready = true;
    const readyResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/readyz`,
    );
    assert.equal(readyResponse.status, 200);
    assert.deepEqual(await readyResponse.json(), { ok: true });
  });

  it("applies CORS policy to normal and preflight requests", async () => {
    const reservation = await listenOnAvailablePort();
    await closeServer(reservation.server);
    const server = new HttpApiServer({
      name: "cors-test",
      port: reservation.port,
      corsAllowedOrigins: ["https://allowed.example"],
    });
    runningServers.push(server);
    await server.start();

    const allowedResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/healthz`,
      { headers: { origin: "https://allowed.example" } },
    );
    assert.equal(allowedResponse.status, 200);
    assert.equal(
      allowedResponse.headers.get("access-control-allow-origin"),
      "https://allowed.example",
    );
    assert.equal(allowedResponse.headers.get("vary"), "Origin");

    const preflightResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/healthz`,
      { method: "OPTIONS", headers: { origin: "https://allowed.example" } },
    );
    assert.equal(preflightResponse.status, 204);

    const rejectedResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/healthz`,
      { headers: { origin: "https://rejected.example" } },
    );
    assert.equal(rejectedResponse.status, 403);
    assert.deepEqual(await rejectedResponse.json(), {
      error: "CORS origin is not allowed",
    });
  });

  it("returns JSON errors for malformed bodies and unhandled route failures", async () => {
    const reservation = await listenOnAvailablePort();
    await closeServer(reservation.server);
    const server = new HttpApiServer({
      name: "error-test",
      port: reservation.port,
      registerRoutes: (app) => {
        app.post("/body", (_request, response) => response.json({ ok: true }));
        app.get("/failure", async () => {
          throw new Error("injected route failure");
        });
      },
    });
    runningServers.push(server);
    await server.start();

    const malformedResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/body`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    assert.equal(malformedResponse.status, 400);
    assert.deepEqual(await malformedResponse.json(), {
      error: "Invalid JSON request body",
    });

    const failureResponse = await fetch(
      `http://127.0.0.1:${reservation.port}/failure`,
    );
    assert.equal(failureResponse.status, 500);
    assert.deepEqual(await failureResponse.json(), {
      error: "Internal server error",
    });
  });

  it("rejects listen errors and runs shutdown cleanup once", async () => {
    const reservation = await listenOnAvailablePort();
    portReservations.push(reservation.server);
    let stopCalls = 0;
    const blockedServer = new HttpApiServer({
      name: "blocked-test",
      port: reservation.port,
      onStop: () => {
        stopCalls += 1;
      },
    });

    await assert.rejects(
      blockedServer.start(),
      (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
    );
    await blockedServer.stop();
    assert.equal(stopCalls, 0);

    await closeServer(reservation.server);
    portReservations.splice(0);
    await Promise.all([blockedServer.start(), blockedServer.start()]);
    runningServers.push(blockedServer);
    await Promise.all([blockedServer.stop(), blockedServer.stop()]);
    runningServers.splice(0);
    assert.equal(stopCalls, 1);
  });
});
