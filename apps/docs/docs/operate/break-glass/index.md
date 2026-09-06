---
title: Break-Glass Operation
sidebar_label: Break-glass operation
audience: operator
page_kind: procedure
---

# Break-Glass Operation

One operator coordinates a break-glass transaction. Five ordered signers remain
separate from the operator. At least three signers must authorize each action.

Read the [CLI prerequisites](../cli/prerequisites.md) before signing. Use the
[CLI command index](../reference/cli-commands.md) to check command options.

Supported actions are:

- pause all guarded treasury operations;
- unpause all guarded treasury operations;
- toggle one proposal pause state;
- rotate the five ordered signer keys;
- withdraw MINA from an enabled Treasury Owner with its account signature.

## Two Emergency Authorization Layers

The Pause Controller uses three valid signatures from five ordered break-glass keys. These signatures authorize pause, unpause, proposal toggle, and key rotation methods.

Emergency fund withdrawal is available only when the Owner deployment uses
`proofOrSignature`. It uses one MINA signature from the Treasury Owner account.
It does not use the Pause Controller signature threshold.

A custody system can require approvals from several people. The MINA network
receives one valid Treasury Owner account signature.

:::danger Treasury Owner key can debit the full available balance

When enabled, the emergency withdrawal path bypasses Proposal approval,
lifecycle rules, recipient checks, the Proposal execution cap, and global
pause. It does not update Proposal `paidOutAmount`.

For `proofOrSignature`, keep the Treasury Owner key as an offline emergency
asset. Prefer a Ledger or another controlled signer. Do not use this path for
normal Proposal execution.

:::

## Safety Checks

Before a signer approves an action, confirm these values:

- MINA network ID;
- Treasury Owner address;
- Pause Controller address;
- current Pause Controller nonce;
- current five-key commitment;
- exact five-key order;
- action type and action-specific data.

Each included action increments the Pause Controller nonce. A signature for an
old nonce cannot authorize the next action.

Stop the operation when a signer sees different data.

## Read Current State

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner read-state

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller read-state
```

Use the nonce from the Pause Controller state. Confirm that the configured
ordered keys create the stored commitment.

## Create CLI Partial Signatures

For a global pause, each participating signer runs:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- multisig-sign pause-treasury \
  --multisig-signer-private-key <SIGNER_PRIVATE_KEY> \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

For a proposal toggle, each signer runs:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- multisig-sign toggle-pause-proposal \
  --multisig-signer-private-key <SIGNER_PRIVATE_KEY> \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

Use the matching `multisig-sign` subcommand for unpause and key rotation.

The signer output includes the participant index. Put each signature in that
exact slot. Empty comma entries keep an unused slot:

```text
<SIG_0>,,<SIG_2>,<SIG_3>
```

The CLI pads unspecified trailing slots. It accepts three through five valid
signatures.

The submit command reads the action nonce from Mina. Omit `--nonce` from submit
commands. The current CLI applies this option to the action nonce and fee-payer
nonce. Use it only when both values are equal.

## Sign with a Ledger

A signer can create a partial field signature with a Ledger:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- multisig-sign pause-treasury \
  --signer=ledger \
  --ledger-signer-public-key=<PARTICIPANT_PUBLIC_KEY> \
  --ledger-account-index=<LEDGER_ACCOUNT_INDEX> \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

The CLI checks the indexed Ledger public key. The command does not prove or
submit a Mina transaction.

## Pause the Treasury

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller pause-treasury \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5> \
  --wait true
```

After inclusion, read Pause Controller state. Confirm `paused=true` and the
incremented nonce.

Then confirm that create, vote, tally, and execute operations fail the global
pause check.

## Emergency Fund Withdrawal

Use this final emergency layer only when the incident response requires direct
custody movement. The deployment must use `proofOrSignature`. The Treasury
Owner signature then authorizes the withdrawal. The 3-of-5 signatures do not
authorize it on the MINA network.

### Preconditions

1. Stop normal transaction submission.
2. Pause the treasury with the 3-of-5 process when that process is available.
3. Confirm `paused=true` directly on the MINA network.
4. Confirm that the selected Owner account has `access=proofOrSignature` and `send=proofOrSignature`.
5. Confirm the MINA network ID, Owner address, recipient, amount, fee payer, fee, and memo.
6. Confirm that the Owner has enough available balance.

The global pause does not block this signed account update. The command rejects
a proof-only Owner before submission. A source change cannot change deployed
permissions. Deploy a new Owner address to select `proofOrSignature`.

### Submit with Ledger

The fee payer and Treasury Owner can use different Ledger accounts. Set both indexes explicitly:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner emergency-withdraw \
  --signer ledger \
  --sender-public-key <FEE_PAYER_PUBLIC_KEY> \
  --sender-ledger-account-index <FEE_PAYER_LEDGER_INDEX> \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --treasury-owner-ledger-account-index <TREASURY_OWNER_LEDGER_INDEX> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount <NANOMINA> \
  --memo <INCIDENT_OR_CHANGE_ID> \
  --wait true
```

The command checks the deployed `access` and `send` permissions before it
builds the transaction. It rejects proof-only deployments. For an enabled
deployment, it creates a signed default-token Treasury Owner AccountUpdate.
It does not compile or prove.

When the fee payer is separate, it pays the transaction fee and any recipient account-creation fee. The Treasury Owner balance supplies only the withdrawal amount.

### Reconcile the Mina Accounts

After inclusion, use one canonical Mina block to confirm:

- the transaction hash and status;
- the Treasury Owner balance decreased by the withdrawal amount;
- the recipient balance increased by the withdrawal amount;
- the Owner nonce increased when it was not the fee payer;
- the fee-payer nonce and fee changed as expected;
- no Proposal state, including `paidOutAmount`, changed.

The withdrawal emits no Treasury Owner event. Do not wait for a `proposalExecuted` event. Treat direct Mina account state as the result.

Do not retry an uncertain transaction until Mina state shows that the first transaction did not apply.

### Keep the Operation Record

Record the incident or change ID, approving authority, network ID, Owner and Pause Controller addresses, pause state, Owner permissions, recipient, amount, fee payer, fee, memo, pre-state balances, included transaction hash, canonical block, post-state balances, source revision, CLI version, and reason.

Do not record a private key, Ledger recovery phrase, or other secret.

Keep the treasury paused until the incident authority approves recovery. Reconcile approved Proposal funding before normal execution resumes.

## Unpause the Treasury

Resolve the incident before unpause. Read the new nonce. Collect a new set of
unpause signatures.

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller unpause-treasury \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5> \
  --wait true
```

After inclusion, confirm `paused=false` and the incremented nonce. Submit one
low-risk operation before normal activity resumes.

## Toggle a Proposal Pause

:::danger Finalized result can be lost

Proposal pause is not a separate Boolean value. Any non-`PAUSED` status becomes
`PAUSED`. A `PAUSED` status becomes `UNKNOWN`.

Toggling an `APPROVED` or `REJECTED` proposal can erase its result.

:::

Read Proposal state before submission:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal read-state \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY>
```

Submit the prepared signatures:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller toggle-pause-proposal \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5> \
  --wait true
```

Read Proposal state after inclusion. Also read the incremented Pause
Controller nonce.

Do not use the event `paused` field as authoritative state. The transaction
caller supplies this event value separately from the Proposal state change.

## Rotate Signer Keys

Confirm five distinct new public keys. Build each partial signature with the
current ordered keys and the new ordered keys:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- multisig-sign rotate-multisig-keys \
  --multisig-signer-private-key <CURRENT_SIGNER_PRIVATE_KEY> \
  --multisig-participants-public-keys <OLD1>,<OLD2>,<OLD3>,<OLD4>,<OLD5> \
  --new-multisig-participants-public-keys <NEW1>,<NEW2>,<NEW3>,<NEW4>,<NEW5> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

Submit the rotation:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller rotate-multisig-keys \
  --current-multisig-participants-public-keys <OLD1>,<OLD2>,<OLD3>,<OLD4>,<OLD5> \
  --new-multisig-participants-public-keys <NEW1>,<NEW2>,<NEW3>,<NEW4>,<NEW5> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5> \
  --wait true
```

After inclusion, confirm the new commitment and nonce. Update the configured
ordered list only after this Mina state check.

## Backoffice Signer and Submitter Flow

The backoffice is a client-only web application. It operates existing
contracts and does not run normal governance actions.

Configure these required values:

```text
NEXT_PUBLIC_NETWORK_ID
NEXT_PUBLIC_MINA_NODE_URL
NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS
NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS
```

Proposal toggling also needs the duration, three verification keys, and two
empty roots from `treasury-owner compile`.

Bootstrap writes these values to `<BACKOFFICE_ENV_FILE>`. Confirm the
ordered participant list and copy the six compile values into this file.

Start the local application:

```bash
dotenvx run -f <BACKOFFICE_ENV_FILE> -- \
  pnpm --dir apps/backoffice run dev
```

The default address is `http://127.0.0.1:3200`. The application disables all
actions when the configured participant commitment differs from Mina state.

The submitter performs these steps:

1. Select `Submitter`.
2. Create and export an unsigned operation file.
3. Send the same file to each required signer.

Each signer performs these steps on an individual machine:

1. Select `Signer`.
2. Import the operation file.
3. Review the network, addresses, nonce, commitment, and action data.
4. Enter the Ledger index for the applicable participant slot.
5. Sign and export the signed copy.
6. Return the signed copy to the submitter.

Ledger indices stay on signer machines. They are not part of exported files.

The submitter then performs these steps:

1. Import the original operation.
2. Merge each signed copy.
3. Confirm that three participant signatures are valid.
4. Select an Auro or Ledger fee payer.
5. Prove and submit the transaction.
6. Download the receipt.

The merge rejects different operation data. It also rejects conflicting
signatures for one participant slot.

After submission, compare the receipt with direct Mina state. For key rotation,
keep the receipt with the new ordered public-key list.

## Sources

- `apps/cli/README.md`
- `apps/cli/src/commands/multisig-sign.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/backoffice/README.md`
- `apps/backoffice/features/operations.ts`
- `apps/backoffice/features/backoffice-app.tsx`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
