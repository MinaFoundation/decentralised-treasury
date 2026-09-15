# Treasury back office

This client-only Next.js app operates the existing treasury break-glass
contracts. It does not deploy contracts or run normal governance operations.

The app supports:

- global treasury pause and unpause;
- proposal pause toggling with the current contract semantics;
- multisig participant rotation;
- Ledger participant signatures;
- Auro or Ledger fee-payer signatures;
- browser proof generation;
- direct Mina node submission;
- JSON signing bundle exchange and receipts.

## Configuration

Set these required values:

```text
NEXT_PUBLIC_NETWORK_ID=testnet
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3200/mina/graphql
NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS=B62...
NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS=B62...,B62...,B62...,B62...,B62...
```

The participant order must match the pause controller commitment. The app
disables all operations when the commitment does not match.

The dashboard polls the configured Mina node every 10 seconds. Bundle creation
and submission also fetch fresh state before they continue.

The header settings button opens the shared endpoint settings dialog. The Mina
node URL applies to status reads, proof generation, submission, and inclusion
checks.

The header wallet button uses the shared wallet workflow from `packages/ui`.
A Ledger connection contains one account index and one public key. The app does
not scan or list Ledger accounts.

## Signer and submitter workflow

The dashboard keeps the workflow inline. Action tabs select the operation. A
step bar shows the current stage. The main controls show the import, export,
sign, or submit action that applies to that stage.

One submitter builds and exports a pure signing bundle. The signing bundle has
no participant signatures. Each signer works on an individual machine:

1. Select `Signer`.
2. Import the submitter's signing bundle.
3. Review the operation data.
4. Connect the Ledger account that controls the participant key.
5. Confirm that the app found the correct participant slot.
6. Sign and export the signature contribution.
7. Return the contribution to the submitter.

The signer machine does not prove, submit, or configure a fee payer. The
signer does not receive or verify other participant signatures.

The submitter then:

1. Selects `Submitter`.
2. Opens the original signing bundle.
3. Uses `Merge signature contribution` for each returned file.
4. Confirms that three participant signatures are valid.
5. Connects the Auro or Ledger fee payer.
6. Proves and submits the transaction.

The merge rejects different operation data and conflicting participant slots.
Ledger indices stay in local wallet sessions. Signing bundles do not contain
Ledger indices.

The key rotation editor compares each new key with the current ordered set. It
marks retained and moved keys. It blocks invalid keys, duplicate keys,
`PublicKey.empty`, and a set that has no change. Signers see the same
current-to-new key review before they can sign a rotation bundle.

Proposal toggling also needs the same verification keys and empty roots as the
main UI. See `.env.testnet.example` for the names.

## Development

From the repository root:

```bash
pnpm --dir apps/backoffice run dev
pnpm --dir apps/backoffice run check-types
pnpm --dir apps/backoffice run test
pnpm --dir apps/backoffice run test:e2e
pnpm --dir packages/ui run storybook
```

The default URL is `http://127.0.0.1:3200`.

## Live local-blockchain test

Run the same browser scenario in this order:

```bash
PROOFS_ENABLED=false pnpm --dir apps/backoffice run test:e2e:local-blockchain
PROOFS_ENABLED=true pnpm --dir apps/backoffice run test:e2e:local-blockchain
```

Each run creates a fresh local chain, treasury, and participant keys. The test
checks the node and browser proof modes. Invalid mode values stop the run.
The default application mode requires proofs. Set `PROOFS_ENABLED` or
`NEXT_PUBLIC_PROOFS_ENABLED` explicitly for a local run without proofs.

The browser builds and exports an unsigned pause bundle. Three separate CLI
calls produce participant signatures. The browser imports each contribution,
proves the transaction, requests the wallet signature, and submits the command.
The test repeats these steps to unpause the treasury. It checks receipts,
controller nonces, on-chain pause state, and displayed state.

The test also checks these failure cases:

- Two signatures do not expose the submit action.
- A contribution with different operation data fails to merge.
- An old bundle fails after the controller nonce changes.

The automated wallet adapter implements the Auro extension boundary. It signs
with a funded local key. The application sends the signed command to the node.
The adapter does not replace the proof worker or submit transactions.

Playwright stores downloads, receipts, state evidence, and failures under
`test-results/local-blockchain/proofs-false` or `proofs-true`. The stack uses a
separate temporary directory for each run. These tests do not cover physical
Ledger approval. Keep the Ledger release check below as a separate manual test.

Storybook contains the back office under `Back office/Complete workflow`.
The stories use fixed preview data. They do not connect to a Mina node, a
wallet, a Ledger device, or the proof worker.

WebHID needs a secure browser context. `localhost` and `127.0.0.1` are secure
contexts for local development.

## Ledger release check

The automated tests mock the WebHID transport. Before a release, use a physical
Ledger in a supported Chromium browser:

1. Open the Mina app on the Ledger and connect one account index.
2. Import a signing bundle in the signer workflow.
3. Confirm that the connected key selects the correct participant slot.
4. Review and approve the field signature on the device.
5. Connect a Ledger key that is not a participant and confirm that the UI
   rejects it before signing.
6. For a Ledger fee payer, review and approve the complete zkApp transaction.

This manual check is required because browser automation cannot approve the
WebHID permission prompt or confirm the physical device screen.
