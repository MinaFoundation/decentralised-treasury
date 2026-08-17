# Publishing and running the images

The published images carry no deployment-specific configuration. The same
`dt-web` image can serve a devnet, a testnet and a mainnet deployment; the
difference is entirely in the environment variables passed at `docker run` time.

## Why the web image used to be environment-specific

Next.js replaces every static `process.env.NEXT_PUBLIC_*` reference with a
string literal during `next build`. The old Dockerfile passed the endpoint URLs
and the treasury address as build args, so those values were compiled into the
client bundle and each deployment needed its own image.

The app now resolves that configuration at container start instead:

1. The root layout is `dynamic = "force-dynamic"`, so it renders per request
   rather than being prerendered at build time.
2. `RuntimeConfigScript` reads the container's environment on the server and
   writes it into an inline `<script>` in `<head>`, ahead of the app bundles.
3. Client code calls `getRuntimeConfig()` (see
   `apps/web/features/runtime-config/`) instead of touching `process.env`.

The build therefore runs with **no** `NEXT_PUBLIC_*` variables set. Setting one
during a build would inline it as a fallback and partly defeat the mechanism.

## Publishing

```sh
docker login                          # as the namespace owner
./devops/scripts/publish-images.sh    # tags from the current commit
```

The script refuses to run on a dirty working tree, because the tag would not
identify the code inside the image. Override with `ALLOW_DIRTY=true` only for
throwaway builds.

It builds two images for `linux/amd64` and `linux/arm64`:

| Dockerfile target | Pushed to | Contents |
| --- | --- | --- |
| `web` | `dt-web` | Next.js standalone server, static assets, public dir |
| `base` | `dt-api`, `dt-api-migrate`, `dt-indexer`, `dt-indexer-api`, `dt-processor`, `dt-processor-api` | the pnpm workspace; services differ only by the command compose runs |

Useful overrides:

```sh
NAMESPACE=my-org ./devops/scripts/publish-images.sh
PLATFORMS=linux/amd64 ./devops/scripts/publish-images.sh   # single arch, much faster
PUSH=false ./devops/scripts/publish-images.sh              # check both arches compile
MOVE_LATEST=false ./devops/scripts/publish-images.sh       # leave :latest where it is
```

Cross-architecture builds run the foreign architecture under QEMU emulation and
are considerably slower than a native build. Building on a native runner per
architecture is the usual way to avoid that.

Confirm what was published:

```sh
docker buildx imagetools inspect minafoundation/dt-web:<tag>
```

## Running the web image

```sh
docker run -p 3100:3100 \
  -e NEXT_PUBLIC_TREASURY_API_URL=https://treasury.example.org/api \
  -e NEXT_PUBLIC_INDEXER_API_URL=https://treasury.example.org/indexer \
  -e NEXT_PUBLIC_PROCESSOR_API_URL=https://treasury.example.org/processor \
  -e NEXT_PUBLIC_MINA_NODE_URL=https://treasury.example.org/mina/graphql \
  -e NEXT_PUBLIC_NETWORK_ID=DEVNET \
  -e TREASURY_OWNER_CONTRACT_ADDRESS=B62q... \
  -e LIFECYCLE_PERIOD_DURATION=7140 \
  minafoundation/dt-web:<tag>
```

Check that a running container picked the values up — the response contains the
snapshot the browser will read:

```sh
curl -s http://127.0.0.1:3100/ | grep -o '__TREASURY_RUNTIME_CONFIG__={.*}'
```

### Configuration reference

Every value is optional; the fallback applies when the variable is unset **or
blank**. Where two names are listed, the first wins and the second is the name
the backend services already use, so a single variable can configure both.

| Variable (first match wins) | Fallback | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_TREASURY_API_URL`, `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:3100/api` | treasury API, as reached **from the browser** |
| `NEXT_PUBLIC_INDEXER_API_URL` | `http://127.0.0.1:3100/indexer` | indexer API |
| `NEXT_PUBLIC_PROCESSOR_API_URL` | `http://127.0.0.1:3100/processor` | processor API |
| `NEXT_PUBLIC_MINA_NODE_URL` | `http://127.0.0.1:3100/mina/graphql` | Mina GraphQL endpoint |
| `NEXT_PUBLIC_NETWORK_ID` | `MAINNET` | network label shown in the UI |
| `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS`, `TREASURY_OWNER_CONTRACT_ADDRESS` | *(none)* | treasury owner contract; balance and actions are disabled without it |
| `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION`, `LIFECYCLE_PERIOD_DURATION` | *(none)* | slots per lifecycle period |
| `NEXT_PUBLIC_SLOT_DURATION_MS` | *(none)* | slot duration, for countdowns |
| `NEXT_PUBLIC_PROOFS_ENABLED` | *(none)* | `false` disables browser proving; any other value enables it |
| `NEXT_PUBLIC_BUILD_SHA`, `BUILD_SHA` | `unknown` | revision shown in the footer; baked into the image at build time |

Browser proving additionally needs the artifacts emitted by the treasury-owner
CLI `compile` command. Proving fails with an explicit "Missing required browser
prover config" error naming the first one missing:

- `NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON`
- `NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON`
- `NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON`
- `NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT`
- `NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT`

The URLs are resolved by the **browser**, not by the web container, so they must
be reachable from the user's machine. An internal address such as
`http://api:4000` will not work.

### Per-browser overrides

The in-app settings dialog stores endpoint overrides in `localStorage` under
`treasury-header-settings`. They take precedence over the container's
environment for that browser, so a returning user keeps their old endpoints
after the deployment is reconfigured. Clearing that key restores the
container's values.

## Running the whole stack from published images

`devops/compose.yml` builds locally by default. Point it at published tags
instead:

```sh
export APP_IMAGE=minafoundation/dt-api:<tag>
export WEB_IMAGE=minafoundation/dt-web:<tag>
pnpm testnet:up      # already passes --no-build
```

The backend services take their configuration from `environment:` in
`compose.yml` and were never build-time specific.
