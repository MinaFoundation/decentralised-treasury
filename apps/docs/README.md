# Treasury documentation site

This Docusaurus site contains User, Operator, and Developer documentation for
the Mina Decentralized Treasury.

## Content structure

Each main audience has the same layered entry path:

1. The audience index helps the reader select a path.
2. The overview gives a short system summary.
3. The quickstart gives the shortest supported working flow.
4. Foundation pages explain unfamiliar concepts from basic terms.
5. Procedure and reference pages provide detailed actions and exact facts.

Use `navigation`, `overview`, `quickstart`, `concept`, `procedure`, or
`reference` as the `page_kind` in main-page front matter.

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
pnpm --dir apps/docs run generate:developer-guides
pnpm --dir apps/docs run generate:runbooks
pnpm docs:check
```

The infrastructure pages are generated from `devops/runbooks`. The generator
includes each complete procedure and each companion YAML file. It also creates
downloadable YAML copies. The content check fails when a generated page or
download does not match its source.

The other checks validate source paths, Markdown, links, terminology,
TypeScript configuration, and the Docusaurus production build. The coverage
check derives identifiers from source and checks that the applicable reference
pages contain them. It does not prove method authorization, proof semantics,
deployed state, or runtime behavior.

The retained Review appendix is historical material outside the three reader paths.
Its legacy generator is not part of the supported maintenance commands.
Use the current source and reader guides for changes; do not treat that appendix as a current verification result.
