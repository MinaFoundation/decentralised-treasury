# Treasury documentation site

This Docusaurus site contains User and Operator documentation for the Mina
Decentralized Treasury.

## Run the site

From the repository root:

```bash
pnpm docs:dev
```

Open `http://127.0.0.1:3300/decentralised-treasury/`.

The local defaults use these URLs:

| Surface              | URL                                             |
| -------------------- | ----------------------------------------------- |
| Documentation origin | `https://minafoundation.github.io`              |
| Documentation path   | `/decentralised-treasury/`                      |
| Treasury application | `http://127.0.0.1:3100`                         |
| Landing page         | `http://127.0.0.1:3300/decentralised-treasury/` |

Set the documentation URLs when you build a hosted site:

```bash
DOCS_URL=https://docs.treasury.example.com \
DOCS_BASE_URL=/ \
TREASURY_APP_URL=https://treasury.example.com \
pnpm docs:build
```

`DOCS_URL` sets the documentation origin. `DOCS_BASE_URL` sets the path below
that origin. `TREASURY_APP_URL` sets the landing-page and navigation links to
the separate treasury application.

The docs build stores these values in its static output. Build the docs again
after you change one of these values. See the
[environment field index](docs/operate/reference/environment-fields.md#docs-landing-page-and-application-url-flow)
for the complete deployment flow.

## Build and serve the production output

```bash
pnpm docs:build
pnpm --dir apps/docs run start
```

## Check the documentation

```bash
pnpm --dir apps/docs run generate:runbooks
pnpm --dir apps/docs run generate:review
pnpm docs:check
```

The infrastructure pages are generated from `devops/runbooks`. The generator
includes each complete procedure and each companion YAML file. It also creates
downloadable YAML copies. The content check fails when a generated page or
download does not match its source.

The other checks validate source records, Markdown, links, terminology,
TypeScript configuration, and the Docusaurus production build. The coverage
check derives identifiers from source and checks that the applicable reference
pages contain them. It does not prove method authorization, proof semantics,
deployed state, or runtime behavior.

The generated Review appendix is not part of the User or Operator instructions.
It lists working assumptions, issues, threats, and review sources.
