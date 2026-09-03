# 2a — Generate Treasury Wallet

Produces one thing: the **funded sender keypair**, the
`<FUNDED_TESTNET_PRIVATE_KEY>` that the happy path in `devops/TESTNET.md` takes
as `--sender-private-key`.

Every other treasury key — treasury owner, pause controller, the five multisig
participants, the voters — is generated for you by `pnpm env:bootstrap testnet`
in `2b`. Do not make those by hand.

The sender is the exception because it is the only key that must already exist
on-chain with a balance: it pays the fee for every deploy and operator
transaction, including the ones the other roles sign. Bootstrap cannot mint MINA,
so this one comes first.

The easiest place to make it is inside a running Mina daemon pod — the `mina`
CLI is already there, so nothing has to be installed.

## Prerequisites

A Mina daemon pod from runbook `1b`. It does not need to be synced; generating a
keypair is offline work. Syncing only matters for step 3.

## 1. Create The Keypair

Set the password and create the account, then read the keypair back, in one
command:

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- bash -c '
  export MINA_PRIVKEY_PASS="naughty blue worm"
  PUB=$(mina accounts create | sed -n "s/^Public key: //p")
  mina advanced dump-keypair --privkey-path "$HOME/.mina-config/wallets/store/$PUB"
'
```

`MINA_PRIVKEY_PASS` must be set, or `mina accounts create` prompts for a
password interactively. It only encrypts the key file on the pod — it is not
part of the keypair and nothing downstream needs it.

Run it interactively instead if you prefer to see each step:

```bash
kubectl exec -it -n devnet deploy/node-0 -c mina -- bash

export MINA_PRIVKEY_PASS='naughty blue worm'
mina accounts create
```

```text
😄 Added new account!
Public key: B62qpeaBQf6KGLvCYxmNdQwWEHSsGUg4p8wrusN4vvwVPWQCzG9nZkR
```

## 2. Read Back The Private Key

`mina accounts create` prints only the public key. The private key comes from
`dump-keypair`, pointed at the file the account was written to:

```bash
mina advanced dump-keypair \
  --privkey-path .mina-config/wallets/store/B62qpeaBQf6KGLvCYxmNdQwWEHSsGUg4p8wrusN4vvwVPWQCzG9nZkR
```

```text
Using Mina keypair private-key password from environment variable MINA_PRIVKEY_PASS
Public key:  B62qpeaBQf6KGLvCYxmNdQwWEHSsGUg4p8wrusN4vvwVPWQCzG9nZkR
Private key: EKEtNikteqFmw7U6hJo1LaKeTVNt5bj7d7zDWdoR6ogNjpVttP2B
```

**Record both.** The private key is what `2b` passes to bootstrap; the public key
is what you fund and what you check a balance against.

Dump it in the same shell that created it. `dump-keypair` needs the same
`MINA_PRIVKEY_PASS`, and the pod has no PVC, so
`~/.mina-config/wallets/store` is wiped on the next restart — a key created and
not dumped is gone.

## 3. Fund It

On devnet, fund the **public key** from the devnet faucet at
https://faucet.minaprotocol.com, or transfer from an already funded account.
Then confirm it landed:

On mainnet, there is no faucet — the public key must be funded by a transfer
from a real, already-funded wallet. Treat the private key generated in step 2
accordingly: it now controls real value and must not be handled the way the
devnet walkthrough below handles it (see Notes).

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- bash -c \
  'curl -s -X POST http://localhost:3085/graphql -H "content-type: application/json" \
     -d "{\"query\":\"{ account(publicKey: \\\"B62q...\\\") { balance { total } nonce } }\"}"'
```

```json
{"data":{"account":{"balance":{"total":"2017400000000"},"nonce":"1"}}}
```

Or, if the daemon's GraphQL endpoint is exposed through an ingress, query it
directly from outside the cluster instead of exec-ing into the pod:

```bash
curl -s -X POST https://<devnet-graphql-ingress-host>/graphql \
  -H "content-type: application/json" \
  -d '{"query":"{ account(publicKey: \"B62q...\") { balance { total } nonce } }"}'
```

`"account": null` means the key has never received funds — on Mina an account
does not exist until it does. Balance is in nanomina, so the figure above is
~2017 MINA.

Leave room beyond the transaction fees: deploying creates several new accounts,
and each new account costs a 1 MINA creation fee.

## 4. Hand Off To The Happy Path

The private key from step 2 is the only input `devops/TESTNET.md` needs from
here:

```bash
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
```

That command generates the treasury owner, pause controller, multisig and voter
identities and writes them into the `.env.testnet` family. Runbook `2b` walks
through it.

## Notes

- The daemon pod is a key *generator*, not a key store — by design. Nothing of
  value should be left in it.
- The private key is printed to stdout, so it lands in terminal scrollback and
  in whatever logs `kubectl exec` writes. Fine for a devnet key like the one
  above, which is disposable. For real value, generate offline.
- The keys shown here are dummies from a devnet walkthrough and are safe to have
  in the repo.

## References

- Bootstrap: `devops/scripts/bootstrap-env.mjs`, `devops/TESTNET.md` §2
- Fee payer usage: `apps/cli/src/commands/treasury-owner.ts` (`SENDER_PRIVATE_KEY`)
- Previous: `1c-Staking-Ledger-Provider` · Next: `2b-Deploy-Contracts`
