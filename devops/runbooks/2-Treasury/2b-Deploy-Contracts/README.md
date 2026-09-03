# 2b — Deploy Contracts

Covers the whole on-chain half of the happy path in `devops/TESTNET.md`:

```bash
CI=true pnpm install --frozen-lockfile
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
# Review apps/api/.env.testnet, apps/cli/.env.testnet, apps/web/.env.testnet.
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner compile
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner deploy
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner fund-treasury --amount 1000000000000
```

By the end you have a deployed, funded treasury and the three things `2c` needs
as inputs: the **treasury owner address**, the **deploy block height**, and the
**verification keys**.

## Prerequisites

- The funded sender private key from `2a`.
- The network from section `1` up: daemon `Synced`, archive fed.

## 1. Install

```bash
CI=true pnpm install --frozen-lockfile
```

## 2. Bootstrap The Env Family

```bash
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
```

This writes four gitignored files:

```text
devops/.env.testnet
apps/api/.env.testnet
apps/cli/.env.testnet
apps/web/.env.testnet
```

It generates every remaining identity for you — treasury owner, pause
controller, the five multisig participants, the five voters. Reruns preserve
what already exists, so `pnpm testnet:env` is safe to repeat. `--fresh-keys`
replaces every identity; `--overwrite-secrets` replaces infrastructure secrets
like `POSTGRES_PASSWORD`. Use neither unless that is what you want.

Do not commit these files or paste them into logs, screenshots, or chat.

Of the four, only **`apps/cli/.env.testnet`** matters for the actual
deployment — it is the file every command in this runbook and in `2c` runs
against. The other three (`devops/.env.testnet`, `apps/api/.env.testnet`,
`apps/web/.env.testnet`) feed the local Compose stack and the web frontend,
not the deploy itself.

## 3. Point At The Network

The generated defaults assume a local Mina node. Against cluster devnet,
`apps/cli/.env.testnet` needs:

```text
MINA_NODE_URL=https://devnet.minaprotocol.network/graphql
```

| Variable | Where it comes from | Who reads it |
| --- | --- | --- |
| `MINA_NODE_URL` | The public Ingress from `1b` — already reachable, no port-forward | Every command that touches the chain, including all of `2c` |

`treasury-owner compile`, `deploy` and `fund-treasury` only need
`MINA_NODE_URL`. Fetching proposal actions against the archive node is handled
by the application running on Kubernetes, not by anything in this runbook or
in `2c`, so there is nothing to set up here for it.

`MINA_NODE_URL` needs none: `1b` exposes the daemon's GraphQL through the
`graphql-proxy` Ingress. Confirm it answers before going further:

```bash
curl -s -X POST https://devnet.minaprotocol.network/graphql \
  -H "content-type: application/json" \
  -d '{"query":"{ syncStatus }"}'
```

Endpoints can also be passed to bootstrap directly rather than edited in
afterwards — see `devops/TESTNET.md` §1.

## 4. Set The Lifecycle Settings

This is the part that is genuinely hard to undo.

```text
LIFECYCLE_PERIOD_DURATION=85
TREASURY_DEPLOYED_AT_SLOT=866700
```

### `LIFECYCLE_PERIOD_DURATION`

The length of one period, in Mina slots. A lifecycle is **four** periods —
proposal creation, voting, tallying, execution.

| Value | Lifecycle length | Use |
| --- | --- | --- |
| `7140` | 4 × 7140 = 4 epochs | **Real devnet and mainnet.** One period = one epoch |
| `85` | 4 × 85 = 340 slots, so 7140 / 340 = **21 lifecycles per epoch** | Testing only — fast lifecycles for a speedrun |

A devnet slot is 90s and an epoch is 7140 slots (7d 10h 30m), so at `7140` a
lifecycle takes about a month, and at `85` about 8.5 hours.

**It is a compile-time constant.** The value is assigned to the contract class
before the circuits are built
(`packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts` sets
`TreasuryOwnerSmartContract.lifecyclePeriodDuration`), so the verification keys
from step 6 are specific to it. Change the number and every key must be
regenerated and re-copied. Keys compiled at the wrong value do not fail at
deploy — they fail much later, the first time a proof is verified on-chain.

### `TREASURY_DEPLOYED_AT_SLOT`

The slot the lifecycle clock starts from. **It must be the first slot of an
epoch**, so lifecycle boundaries line up with the staking ledgers that give
votes their weight.

Read it off the daemon — the first slot of the current epoch is the best tip's
global slot minus its slot-within-epoch:

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- mina client status \
  | grep -E "Best tip consensus time|Best tip global slot|Slots per epoch"
```

```text
Best tip consensus time:                       epoch=1, slot=6641
Best tip global slot (across all hard-forks):  873341
        Slots per epoch:           7140
```

```text
873341 - 6641 = 866700    <- first slot of epoch 1
866700 + 7140 = 873840    <- first slot of epoch 2
```

Use the global "across all hard-forks" number, not the epoch-relative one. Add
`7140` per epoch to target a future one. Deploying at a slot that is already in
the past is fine — lifecycle 0 simply starts behind the chain.

## 5. Compile

**Clear the compile caches first.** A stale cached circuit artifact yields a
verification key that no longer matches the source. The deployed contract sets
`setVerificationKey: Impossible`, so the mismatch does not fail at deploy — it
fails at the first on-chain proof verification (typically `fund-treasury`, as
`Invalid_proof (Pickles.verify dlog_check)`), and by then the only fix is a full
redeploy at a new address.

```bash
rm -rf apps/cli/cache packages/sdk/cache .turbo/cache

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner compile
```

Do this on every compile that feeds a real deploy, not only when circuit code
visibly changed — the whole point is that a stale cache diverges silently.

Compiling takes a while. The log line reports the value in force:

```text
[treasury-owner:compile] starting (lifecyclePeriodDuration=85)
```

Check that number is the one you meant before using the output.

## 6. Copy The Verification Keys

`compile` emits a `browserEnv` block with six values:

```text
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION
NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON
NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON
NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON
NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT
NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT
```

They go to two places:

1. **`apps/web/.env.testnet`** — for the local Compose stack. Later
   `pnpm testnet:env` runs preserve them.
2. **`2c-Deploy-Stack/verification-keys.yaml`** — for the cluster web frontend,
   under `web.publicEnv`. Kept in its own file because each key is a single
   multi-kilobyte line.

Without them the web app cannot create, vote, tally, or execute proposals.

Never copy this file between networks or between two different
`LIFECYCLE_PERIOD_DURATION` values. Different duration means different circuits
means different keys, and the failure surfaces at proof time rather than at
deploy.

## 7. Deploy The Contracts

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner deploy
```

```json
{
  "pauseControllerAddress": "...",
  "treasuryOwnerAddress": "...",
  "pauseControllerTxHash": "...",
  "treasuryOwnerTxHash": "..."
}
```

**Record `treasuryOwnerAddress`.** It becomes `config.treasuryOwnerContractAddress`
in `2c`'s helmfile. A wrong address indexes nothing at all rather than erroring.

**Also note the block height the deploy landed at.** `2c` needs a value just
below it for `EVENTS_START_HEIGHT`.

The address is already written into `apps/api/.env.testnet`,
`apps/web/.env.testnet` and `apps/cli/.env.testnet`. If you replace the treasury
owner keypair by hand, copy the deployed address into all three.

Verify the deployed state:

```bash
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner read-state
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- pause-controller read-state
```

## 8. Fund The Treasury

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner fund-treasury \
  --amount 1000000000000
```

`--amount` is in **nanomina** — 10⁹ nanomina to 1 MINA, so the figure above is
1000 MINA.

This is the first time a proof is verified on-chain, so it is where a
verification key that does not match the deployed contract surfaces, as
`Invalid_proof (Pickles.verify dlog_check)`. The contract deploys with
`setVerificationKey: Impossible`, so there is no fix short of redeploying at a
new address — which is why step 5 insists on clearing the compile caches.

## Verify Before Moving On

```bash
grep -E '^(MINA_NODE_URL|LIFECYCLE_PERIOD_DURATION|TREASURY_DEPLOYED_AT_SLOT|PROOFS_ENABLED)=' \
  apps/cli/.env.testnet
```

- `MINA_NODE_URL` answers `{"data":{"syncStatus":"SYNCED"}}`
- `LIFECYCLE_PERIOD_DURATION` is the value you compiled at
- `TREASURY_DEPLOYED_AT_SLOT` is a first-slot-of-epoch number
- `verification-keys.yaml` has all five key/root entries filled in
- You have recorded `treasuryOwnerAddress` and the deploy block height
- `read-state` returns state for both contracts, and `fund-treasury` succeeded

## References

- Happy path: `devops/TESTNET.md` §2, §3, §5, §6
- Bootstrap: `devops/scripts/bootstrap-env.mjs`, `create-testnet-env.mjs`
- Compile: `apps/cli/src/commands/treasury-owner.ts`,
  `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- Previous: `2a-Generate-Treasury-Wallet` · Next: `2c-Deploy-Stack`
