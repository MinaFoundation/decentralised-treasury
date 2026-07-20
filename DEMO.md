# Mina Decentralized Treasury Demo

This is the guided local demo path. It uses the in-repo local blockchain
simulator plus the same package-local env layout as the real Mina testnet flow.
For the real Mina testnet operator path, see `devops/TESTNET.md`; for Compose
reference material, see `devops/README.md`.

## 1. Bootstrap Local Env Files

```zsh
pnpm env:bootstrap local-blockchain
```

This writes ignored runtime env files:

```text
devops/.env.local-blockchain
apps/api/.env.local-blockchain
apps/cli/.env.local-blockchain
apps/web/.env.local-blockchain
packages/local-blockchain/.env.local-blockchain
```

Rerunning the command preserves generated keys and browser prover config. Use
`-- --fresh-keys` only when you intentionally want new demo identities.

## 2. Start The Local Blockchain

```zsh
pnpm local-blockchain:start
```

Open `http://127.0.0.1:8080/admin`. The local blockchain exposes funded test
accounts there. Copy one funded private key into `SENDER_PRIVATE_KEY` in
`apps/cli/.env.local-blockchain` before deploying or funding contracts.

For the dummy ledger used by this demo, set these admin values:

```text
stakingEpochDataLedgerTotalCurrency=3117000000000
stakingEpochDataLedgerHash=17443396010975171396732854383516597977946407782519893753313158508372652393077
```

These values match the dummy ledger fixture and the exhausted proof inputs used
by the local demo. A small fixture is available at
`packages/sdk/test/test-ledger-mini.json`.

## 3. Build Lifecycle Ledger Data

Populate the lifecycle staking ledger SQLite from the dummy JSON:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path packages/sdk/test/test-ledger-mini.json
```

Compile and prove the staking-ledger-to-voting-ledger circuit:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger compile

docker run --rm -p 6379:6379 redis:7-alpine

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev worker start \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

In another terminal:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id 0 \
  --proof-output-path .data/local-blockchain-staking-ledger-merge.json \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id 0 \
  --proof-output-path .data/local-blockchain-staking-ledger-exhausted.json
```

## 4. Compile Browser Prover Config

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev treasury-owner compile
```

Copy the emitted `browserEnv` values into `apps/web/.env.local-blockchain`.
Future `pnpm env:bootstrap local-blockchain` runs preserve those values.

## 5. Deploy And Fund Treasury

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev treasury-owner deploy

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev treasury-owner fund-treasury \
  --amount 1000000000000
```

## 6. Start The App Stack

```zsh
pnpm local-blockchain:up:build
```

Then open the UI through the proxy:

```text
http://127.0.0.1:3100
```

API endpoints are proxied on:

```text
http://127.0.0.1:4100
http://127.0.0.1:4101
http://127.0.0.1:4102
```

## 7. Create, Vote, Tally, Execute

Use the UI to create a proposal. To fund a browser proposer account, send MINA
to one of the `VOTER*_PUBLIC_KEY` accounts from
`apps/cli/.env.local-blockchain`:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev transfer \
  --recipient-public-key <VOTER_PUBLIC_KEY> \
  --amount 100000000000
```

Advance slots in the local blockchain admin UI to move through proposal
lifecycle phases. Fetch actions, reduce votes, and tally using the same env:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal fetch-actions \
  --archive-node-url http://127.0.0.1:8282/graphql \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/local-blockchain-vote-actions.json

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal tally-votes \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote-reducer-proof-path .data/local-blockchain-vote-reducer-merge.json \
  --staking-ledger-to-voting-ledger-proof-path .data/local-blockchain-staking-ledger-exhausted.json \
  --lifecycle-id 0 \
  --wait true
```

Execute the proposal from the UI after the cooldown period ends.

## Real Mina Testnet Path

For the same treasury flow against a real Mina node on GraphQL `3001` and
archive `8282`, use:

```zsh
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
pnpm testnet:up:build
```

The detailed real-node setup, staking ledger export, archive requirements, and
operator checklist live in `devops/TESTNET.md` and
`devops/TESTNET_MINA_NODE.md`.
