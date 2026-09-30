---
title: Container Images
sidebar_label: Container images
audience: developer
page_kind: procedure
---

# Container Images

Container images package the application code once. Runtime environment values
connect that code to a specific Treasury deployment.
The `**/.env*` rule excludes environment files and templates at every folder depth from new builds.
The root `output/` and `tmp/` directories are also outside the build context.
Compose and Helm supply runtime values outside the image. Older published images require separate inspection and cleanup.

## Image Targets

| Docker target | Published use                                                        |
| ------------- | -------------------------------------------------------------------- |
| `web`         | Next.js Treasury application.                                        |
| `backoffice`  | Next.js break-glass application.                                     |
| `base`        | API, indexer, processor, migration, scheduler, and worker processes. |

Backend images share the `base` filesystem. The orchestrator selects their
process command.

## Browser Runtime Configuration

The web and Backoffice containers write public configuration into the page at
request time. Client code reads this object through the runtime configuration
module.

Do not set `NEXT_PUBLIC_*` deployment values during image build. Next.js can
inline such values into the client bundle.

Recreate the container after a runtime value changes. A browser-local endpoint
override can still take precedence until the user clears it.

## Build And Publish

The publishing script uses the current commit for tags. It rejects a dirty
worktree by default.

Run the synthetic build-context check before release:

```bash
DOCKER_IGNORE_TEST=true node --test devops/test/docker-env-exclusion.test.mjs
```

Inspect replacement image layers before publication. Check filenames without printing secret values.

```bash
docker login
./devops/scripts/publish-images.sh
```

Use a single architecture for a faster local build check:

```bash
PLATFORMS=linux/amd64 PUSH=false ./devops/scripts/publish-images.sh
```

Do not use the dirty-worktree override for a release.

## Verify An Image

Inspect a published multi-architecture image:

```bash
docker buildx imagetools inspect minafoundation/dt-web:<IMAGE_TAG>
```

Check the runtime configuration from a running web container:

```bash
curl --silent http://127.0.0.1:3100/ | \
  grep -o '__TREASURY_RUNTIME_CONFIG__={.*}'
```

## Use Published Images In Compose

Set the image variables before the no-build start command:

Use verified replacement tags. The audit identified `minafoundation/dt-api:41c4809` and `minafoundation/dt-api:265b1c9` as affected images.
These examples do not establish that other older tags are clean.
Follow the registry inventory and cleanup procedure in `devops/PUBLISHING.md` before release.

```bash
export APP_IMAGE=minafoundation/dt-api:<IMAGE_TAG>
export WEB_IMAGE=minafoundation/dt-web:<IMAGE_TAG>
export BACKOFFICE_IMAGE=minafoundation/dt-backoffice:<IMAGE_TAG>
pnpm testnet:up
```

Use [Deployment integration](deployments.md) for configuration relationships.
Use [Service procedures](../../operate/services/service-operations.md) for
deployed Compose operation.

## Sources

- `devops/PUBLISHING.md`
- `devops/scripts/publish-images.sh`
- `devops/docker/Dockerfile`
- `apps/web/features/runtime-config/`
- `apps/backoffice/features/runtime-config.ts`
- `devops/compose.yml`
