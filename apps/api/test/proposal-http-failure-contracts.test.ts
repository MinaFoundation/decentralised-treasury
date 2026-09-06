import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataSource } from "typeorm";
import { createProposalContentRoutes } from "../src/proposal-content-routes.js";
import { createProposalListRoutes } from "../src/proposal-list-routes.js";
import { createProposalSearchRoutes } from "../src/proposal-search-routes.js";

type RouteHandler = (
  request: {
    body?: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
  },
  response: ResponseRecorder,
) => Promise<void>;

interface ResponseRecorder {
  json(body: unknown): ResponseRecorder;
  status(statusCode: number): ResponseRecorder;
}

function captureGetRoutes(registerRoutes: (app: never) => void) {
  const handlers = new Map<string, RouteHandler>();
  registerRoutes({
    get: (path: string, handler: RouteHandler) => {
      handlers.set(path, handler);
    },
  } as never);
  return handlers;
}

function capturePostRoutes(registerRoutes: (app: never) => void) {
  const handlers = new Map<string, RouteHandler>();
  registerRoutes({
    post: (path: string, handler: RouteHandler) => {
      handlers.set(path, handler);
    },
  } as never);
  return handlers;
}

function createResponseRecorder() {
  let statusCode = 200;
  let payload: unknown;
  const response: ResponseRecorder = {
    json: (body: unknown) => {
      payload = body;
      return response;
    },
    status: (value: number) => {
      statusCode = value;
      return response;
    },
  };
  return {
    response,
    result: () => ({ statusCode, payload }),
  };
}

function failingDataSource(error: unknown): DataSource {
  return {
    options: { schema: "public" },
    query: async () => {
      throw error;
    },
  } as unknown as DataSource;
}

function assertHandler(
  handlers: Map<string, RouteHandler>,
  path: string,
): RouteHandler {
  const handler = handlers.get(path);
  assert.ok(handler, `expected route handler for ${path}`);
  return handler;
}

async function invokeGetFailure(
  registerRoutes: (app: never) => void,
  path: string,
  request: { params: Record<string, string>; query: Record<string, string> },
) {
  const handler = assertHandler(captureGetRoutes(registerRoutes), path);
  const recorder = createResponseRecorder();
  await handler(request, recorder.response);
  return recorder.result();
}

async function invokeContentFailure(
  dataSource: DataSource,
  hashMarkdownToProposalZkAppUriHash: () => Promise<{
    zkAppUri: string;
    zkAppUriHash: string;
  }>,
) {
  const handlers = capturePostRoutes(
    createProposalContentRoutes({
      dataSource,
      containsExplicitLanguage: () => false,
      hashMarkdownToProposalZkAppUriHash,
    }) as (app: never) => void,
  );
  const handler = assertHandler(handlers, "/proposals/:id/content");
  const recorder = createResponseRecorder();
  await handler(
    {
      body: { contents: "# Contract-bound proposal" },
      params: { id: "proposal-public-key" },
      query: {},
    },
    recorder.response,
  );
  return recorder.result();
}

describe("proposal HTTP failure contracts", () => {
  it("returns route-specific 503 responses when the proposal table is missing", async () => {
    const missingTableError = Object.assign(
      new Error("relation does not exist"),
      {
        code: "42P01",
      },
    );
    const dataSource = failingDataSource(missingTableError);
    const routes = createProposalListRoutes({ dataSource }) as (
      app: never,
    ) => void;

    assert.deepEqual(
      await invokeGetFailure(routes, "/proposals", {
        params: {},
        query: {},
      }),
      {
        statusCode: 503,
        payload: { error: "proposal list API is unavailable" },
      },
    );
    assert.deepEqual(
      await invokeGetFailure(routes, "/proposals/:proposalPublicKey", {
        params: { proposalPublicKey: "proposal-public-key" },
        query: {},
      }),
      {
        statusCode: 503,
        payload: { error: "proposal detail API is unavailable" },
      },
    );
  });

  it("returns 500 for other proposal list and detail database failures", async () => {
    const dataSource = failingDataSource(
      new Error("database connection failed"),
    );
    const routes = createProposalListRoutes({ dataSource }) as (
      app: never,
    ) => void;

    assert.deepEqual(
      await invokeGetFailure(routes, "/proposals", {
        params: {},
        query: {},
      }),
      {
        statusCode: 500,
        payload: { error: "Internal server error" },
      },
    );
    assert.deepEqual(
      await invokeGetFailure(routes, "/proposals/:proposalPublicKey", {
        params: { proposalPublicKey: "proposal-public-key" },
        query: {},
      }),
      {
        statusCode: 500,
        payload: { error: "Internal server error" },
      },
    );
  });

  it("keeps proposal search 503 and 500 database failures distinct", async () => {
    for (const [error, expected] of [
      [
        Object.assign(new Error("relation does not exist"), { code: "42P01" }),
        {
          statusCode: 503,
          payload: { error: "proposal search API is unavailable" },
        },
      ],
      [
        new Error("database connection failed"),
        {
          statusCode: 500,
          payload: { error: "Internal server error" },
        },
      ],
    ] as const) {
      const routes = createProposalSearchRoutes({
        dataSource: failingDataSource(error),
      }) as (app: never) => void;
      assert.deepEqual(
        await invokeGetFailure(routes, "/proposals/search", {
          params: {},
          query: { q: "treasury" },
        }),
        expected,
      );
    }
  });

  it("returns 500 when proposal content hashing fails", async () => {
    const dataSource = {
      options: { schema: "public" },
      transaction: async () => {
        assert.fail(
          "the route must not start a transaction after hash failure",
        );
      },
    } as unknown as DataSource;

    assert.deepEqual(
      await invokeContentFailure(dataSource, async () => {
        throw new Error("hash dependency failed");
      }),
      {
        statusCode: 500,
        payload: { error: "Internal server error" },
      },
    );
  });

  it("keeps proposal content 503 and 500 database failures distinct", async () => {
    for (const [error, expected] of [
      [
        Object.assign(new Error("relation does not exist"), { code: "42P01" }),
        {
          statusCode: 503,
          payload: { error: "proposal content API is unavailable" },
        },
      ],
      [
        new Error("database write failed"),
        {
          statusCode: 500,
          payload: { error: "Internal server error" },
        },
      ],
    ] as const) {
      const dataSource = {
        options: { schema: "public" },
        transaction: async () => {
          throw error;
        },
      } as unknown as DataSource;

      assert.deepEqual(
        await invokeContentFailure(dataSource, async () => ({
          zkAppUri: "urn:proposal-content:test",
          zkAppUriHash: "contract-hash",
        })),
        expected,
      );
    }
  });
});
