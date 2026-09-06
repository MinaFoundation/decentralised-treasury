---
title: API Reference
sidebar_label: API Reference
sidebar_position: 1
audience: operator
page_kind: navigation
---

# API Reference

The application has three HTTP surfaces.

- [App API](./app-api.md) publishes proposal aggregates, content routes, and lifecycle ledger routes.
- [Indexer API](./indexer-api.md) publishes indexed events and indexer progress.
- [Processor API](./processor-api.md) publishes projection entities and processor progress.

## Base URLs

| Surface | Container URL | Local direct URL | Web same-origin prefix |
| --- | --- | --- | --- |
| App API | `http://api:4000` | `http://127.0.0.1:4100` | `/api` |
| Indexer API | `http://indexer-api:4001` | `http://127.0.0.1:4101` | `/indexer` |
| Processor API | `http://processor-api:4002` | `http://127.0.0.1:4102` | `/processor` |

Caddy removes the same-origin prefix before it sends the request upstream.
For example, `/api/proposals` becomes `/proposals` on the App API.

## Common HTTP behavior

All three surfaces return JSON.
Each surface supplies `GET /healthz` with this response:

```json
{
  "ok": true
}
```

This response only means that the HTTP process responds.
It does not test a database, Archive GraphQL, or a worker loop.

The servers apply a CORS allow list.
A disallowed browser origin receives `403`.
An allowed `OPTIONS` request receives `204`.

The current route wiring does not add route-level authentication.
Apply deployment access controls before you expose a route that requires them.
