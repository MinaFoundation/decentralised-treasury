---
title: Signing with Ledger and Auro
sidebar_label: Ledger and Auro signing
sidebar_position: 11
audience: user
page_kind: procedure
---

Signing proves that a key holder approved specific data. It does not prove that
Mina accepted a transaction or changed the expected account state.

## Understand the two signature types

### Mina transaction signatures

A Mina transaction always has a fee payer. The fee payer signs the complete
transaction and pays its network fee.

Some transactions need more signatures. For example, a vote can need the voter
signature, and an emergency withdrawal needs the Treasury Owner signature.

Auro and Ledger can sign browser transactions. The CLI can sign transactions
with Ledger or with private keys in `in-memory` mode.

The browser and CLI can also build contract proofs. A proof is not a wallet
signature. Mina checks all required proofs and signatures before acceptance.

### Break-glass field signatures

A break-glass signer signs one message hash. The Pause Controller proof checks
this signature against one position in the ordered five-key participant set.

At least three valid participant positions must sign. These signatures are data
inside the proved transaction. They are not fee-payer signatures.

Backoffice participant signing supports Ledger only. The Backoffice fee payer
can use Auro or Ledger.

The CLI `multisig-sign` commands support Ledger or `in-memory` private-key
signing. These commands create one field signature and do not submit a
transaction.

The signed field does not include the network ID or either contract address. A
pause or unpause field includes its operation prefix and controller nonce.

A Proposal toggle also includes the Proposal address. A key rotation also
includes the current and new participant commitments. Check all other bundle
values separately.

:::warning Keep the two approvals separate

A break-glass action needs three participant signatures and one fee-payer
signature. One signature type cannot replace the other type.

:::

## Check operation and wallet support

The matrix covers each command that submits a signed, state-changing Mina
transaction. It covers the main web application, Backoffice, and CLI. A dash
means that the surface does not expose that operation.

The four break-glass rows include both required approvals. They link the
participant field-signature procedure and the final transaction procedure.

| State-changing operation                       | Main web application                                                                    | Backoffice                                                                                                                                                                                           | CLI                                                                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy Treasury Owner and Pause Controller     | —                                                                                       | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`treasury-owner deploy`](/operate/deployment/deploy-the-treasury#deploy-the-contracts)                                                                                       |
| Deploy a Pause Controller separately           | —                                                                                       | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`pause-controller deploy` procedure](/operate/cli/prerequisites#deploy-only-a-pause-controller-with-ledger)                                                                    |
| Fund the Treasury Owner                        | —                                                                                       | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`treasury-owner fund-treasury`](/operate/lifecycle/ideal-lifecycle#1-fund-and-reconcile)                                                                                     |
| Create a Proposal                              | Auro or Ledger: [web procedure](./create-a-proposal.md#create-in-the-web-application)   | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`proposal create`](/operate/lifecycle/ideal-lifecycle#4-create-a-proposal-and-reconcile)                                                                                     |
| Vote on a Proposal                             | Auro or Ledger: [web procedure](./vote.md#vote-in-the-web-application)                  | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`proposal vote`](/operate/lifecycle/ideal-lifecycle#5-vote-and-reconcile)                                                                                                    |
| Tally Proposal votes                           | —                                                                                       | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`proposal tally-votes`](/operate/lifecycle/ideal-lifecycle#7-tally-and-reconcile)                                                                                            |
| Execute an approved Proposal                   | Auro or Ledger: [web procedure](./execute-a-proposal.md#execute-in-the-web-application) | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`proposal execute`](/operate/lifecycle/ideal-lifecycle#8-execute-an-approved-proposal-and-reconcile)                                                                         |
| Emergency Treasury Owner withdrawal            | —                                                                                       | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`treasury-owner emergency-withdraw` procedure](/operate/break-glass#emergency-fund-withdrawal)                                                                               |
| Pause the Treasury                             | —                                                                                       | Ledger participants and Auro or Ledger fee payer: [pause checks](/operate/break-glass#pause-the-treasury), then [Backoffice flow](/operate/break-glass#backoffice-signer-and-submitter-flow)         | Ledger or `in-memory`: [create participant signatures](/operate/reference/cli-commands#multisig-sign), then [`pause-controller pause-treasury`](/operate/break-glass#pause-the-treasury)             |
| Unpause the Treasury                           | —                                                                                       | Ledger participants and Auro or Ledger fee payer: [unpause checks](/operate/break-glass#unpause-the-treasury), then [Backoffice flow](/operate/break-glass#backoffice-signer-and-submitter-flow)     | Ledger or `in-memory`: [create participant signatures](/operate/reference/cli-commands#multisig-sign), then [`pause-controller unpause-treasury`](/operate/break-glass#unpause-the-treasury)         |
| Toggle one Proposal pause state                | —                                                                                       | Ledger participants and Auro or Ledger fee payer: [Proposal checks](/operate/break-glass#toggle-a-proposal-pause), then [Backoffice flow](/operate/break-glass#backoffice-signer-and-submitter-flow) | Ledger or `in-memory`: [create participant signatures](/operate/reference/cli-commands#multisig-sign), then [`pause-controller toggle-pause-proposal`](/operate/break-glass#toggle-a-proposal-pause) |
| Rotate the ordered break-glass keys            | —                                                                                       | Ledger participants and Auro or Ledger fee payer: [rotation checks](/operate/break-glass#rotate-signer-keys), then [Backoffice flow](/operate/break-glass#backoffice-signer-and-submitter-flow)      | Ledger or `in-memory`: [create participant signatures](/operate/reference/cli-commands#multisig-sign), then [`pause-controller rotate-multisig-keys`](/operate/break-glass#rotate-signer-keys)       |
| Transfer MINA without a Treasury contract call | —                                                                                       | —                                                                                                                                                                                                    | Ledger or `in-memory`: [`transfer` procedure](/operate/cli/prerequisites#transfer-mina-with-ledger)                                                                                                    |

The [multisig-sign command
table](/operate/reference/cli-commands#multisig-sign) names all four CLI
participant-signature commands and their exact options.

The source also has a direct Pause Controller Proposal-toggle authorization
method. It increments the controller nonce but does not change Proposal state.
The three user surfaces do not expose this direct method. See the
[Pause Controller warning](/operate/reference/pause-controller#lifecycle-and-state-conditions).

Compile commands, read commands, proof builders, and key generators do not
submit signed, state-changing Mina transactions. Local file and checkpoint
utilities also do not submit these transactions. The matrix does not include
them.

## Select the browser network and endpoint

Both browser applications read public runtime values when they start. Confirm
the network ID, Mina node URL, and Treasury Owner address before connection.

For native development, load the selected application configuration before you
start the application. The main web application uses port `3100`. Backoffice
uses port `3200`.

The Backoffice default Mina path is `http://127.0.0.1:3200/mina/graphql`. This
path needs the same-origin proxy. Configure a reachable node URL when you run
Backoffice without that proxy.

The Compose testnet stack publishes the main web application on port `3100`.
It publishes Backoffice on port `3200`. Each application uses its own
same-origin `/mina/graphql` proxy path.

The raw Compose fallback for `NEXT_PUBLIC_NETWORK_ID` is `MAINNET`. The
generated testnet environment selects `DEVNET` unless you pass another
`--network-id`. Confirm the generated value before startup. The stack name does
not select the signature network.

The public HTTPS profile publishes the main web application only. It does not
publish Backoffice. Keep Backoffice on loopback, or supply a controlled secure
route.

Apply the complete [browser runtime
configuration](/operate/lifecycle/configure-the-treasury#apply-the-selected-runtime-values).
Use the [service procedure](/operate/services/service-operations#start-the-normal-stack)
for the Compose stack.

## Set up Auro in a browser

1. Open the main web application or Backoffice in a supported browser.
2. Select **Connect wallet**, and then select **Auro**.
3. If Auro is unavailable, select **Install Auro** and install the extension.
4. In Auro, select the intended Mina network and funded account.
5. Approve the account connection request.
6. Confirm that the application shows the expected public key.

Before approval, compare the Auro network with the application network. Also
check the fee, memo, operation, recipient, amount, and public keys.

Auro signs Mina transactions only. It cannot create a Backoffice participant
field signature.

## Set up Ledger in a browser

1. Use a Chromium browser that supports WebHID.
2. Use HTTPS, `http://localhost`, or `http://127.0.0.1` as the application
   origin.
3. Connect and unlock the Ledger device.
4. Close Ledger Live if it holds the device connection.
5. Open Mina app version `1.6.7` or newer.
6. Enable blind signing in the Mina app.
7. Select **Connect wallet**, and then select **Ledger**.
8. Enter the exact Ledger account index.
9. Approve the address request on the device.
10. Compare the displayed public key with the intended signing key.

The browser does not scan Ledger accounts. Disconnect and connect again to use
a different account index.

For a normal web transaction, the Ledger signs the fee-payer authorization. It
also signs required AccountUpdates owned by the same connected key.

For a Backoffice participant contribution, the Ledger signs only the operation
message hash. The connected key must match one participant position.

## Set up Ledger for the CLI

1. Connect and unlock the Ledger device.
2. Open the Mina app and enable blind signing.
3. Close Ledger Live.
4. Run the command from the repository root.
5. Set `--signer=ledger`.
6. Set `--network-id` or `MINA_NETWORK_ID` for the target network.
7. Supply one expected public key and account index for each signing role.
8. Review and approve each request on the device.

The CLI accepts `mainnet`, `devnet`, and `testnet`. It does not derive the
network ID from the Mina node URL.

The CLI does not scan accounts. It verifies that each supplied account index
returns its expected public key.

Some commands have multiple signing roles. Review the
[signing options table](/operate/reference/cli-commands#signing-options) before
you run deployment, funding, voting, or withdrawal commands.

For CLI Proposal creation, both signing roles use the selected signer mode.
Ledger mode requires a Proposal public key and Ledger account index.
In-memory mode accepts a Proposal private key or generates one.

## Sign a Backoffice break-glass action

The Backoffice separates participant signing from final transaction signing.
Use one machine for each participant contribution.

Signer mode imports a bundle, signs one participant position, and exports a
contribution. It preserves valid imported signatures. It cannot prove or submit.

Submitter mode builds or imports the bundle and merges contributions. It proves
and submits, but it does not create participant signatures.

1. The submitter creates and exports one unsigned bundle.
2. Each signer imports an unsigned or partially signed bundle in **Signer** mode.
3. Each signer compares the bundle with current Mina state.
4. Each signer connects the exact participant Auro or Ledger account.
5. Each signer approves one field signature and exports one contribution.
6. The submitter merges at least three valid contributions.
7. The submitter connects an Auro or Ledger fee payer.
8. The submitter proves, signs, submits, and saves the receipt.

Before a participant signs, check these bundle values:

- network ID;
- Treasury Owner and Pause Controller addresses;
- operation type;
- controller nonce;
- current participant commitment;
- exact ordered participant list;
- Proposal address for a Proposal toggle;
- current and new ordered keys for a key rotation.

Signer mode verifies existing signatures and rejects invalid signatures.
If the connected participant has already signed, the signer can export the
bundle without another signing request. The signer must manually compare the
imported bundle with current Mina state.

Auro participant signing uses
[`signFields`](https://docs.aurowallet.com/general/reference/api-reference/methods/mina_signfields).
The app verifies the returned signature against the participant key and operation hash.

Each contribution must match every unsigned bundle field. The merge rejects a
different field or a conflicting signature in the same participant position.
Ledger account indices remain local and do not enter the bundle.

The submitter checks the bundle again before submission. A changed nonce,
commitment, Proposal status, or deployment needs a new bundle and new
signatures.

Use the complete [Backoffice signer and submitter
procedure](/operate/break-glass#backoffice-signer-and-submitter-flow).

## Respond to wallet changes

Auro reports selected-account changes to the browser applications. The displayed
wallet session changes or disconnects when Auro reports a new account list.

Stop the active transaction if the Auro account changes. Start again with the
new account, or select the original account in Auro.

Auro rejects signing when its selected account differs from the prepared fee
payer. It also rejects a transaction that contains another fee payer.

A Ledger session records one public key and one account index. The browser does
not detect a different Ledger account automatically.

Disconnect the Ledger session before you change its account index. Confirm the
new address on the device, and then prepare the transaction again.

Do not reuse a proved transaction after any wallet, network, fee, memo, or nonce
change.

## Check each approval

Before a Mina transaction signature, confirm:

- the Mina network and node endpoint;
- the connected public key and its role;
- the fee-payer public key;
- the fee, memo, and nonce;
- all recipient addresses and MINA amounts;
- the Proposal or contract addresses;
- the action and expected result.

For CLI commands, use a command option or environment value for each required
role. Do not put a production private key in a browser environment file.

After submission, keep the transaction hash. Wait for inclusion, and then read
the affected Mina accounts directly.

A transaction hash does not prove the expected result. Compare the observed
state with the approved operation before you continue.

## Handle common failures

| Failure                                    | Meaning                                                            | Action                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Auro is unavailable                        | The extension is absent or disabled.                               | Install or enable Auro, and then reload the page.                        |
| Auro returned no account                   | No account is selected or access was denied.                       | Select the intended account and connect again.                           |
| Auro uses another network                  | The application does not check Auro's selected network.            | Select the configured network in Auro before you sign.                   |
| Prepared transaction has another fee payer | The wallet session and transaction do not match.                   | Stop and prepare the transaction again.                                  |
| Ledger option is disabled                  | The browser lacks WebHID or the origin is not secure.              | Use supported Chromium on HTTPS or a loopback origin.                    |
| Ledger address request failed              | The device, Mina app, or transport is unavailable.                 | Unlock the device, open Mina, close Ledger Live, and retry.              |
| Ledger public key mismatch                 | The account index does not control the expected role key.          | Stop and enter the correct account index.                                |
| Ledger returned an invalid signature       | The device result failed local verification.                       | Stop. Reconnect the device and verify its software and Mina app version. |
| Unsupported network ID                     | The configured value is not supported by the selected signer.      | Use `mainnet`, `devnet`, or `testnet` as applicable.                     |
| Fee-payer account not found                | The selected account does not exist on the configured Mina node.   | Check the network and endpoint, or fund the account.                     |
| Insufficient balance                       | The fee payer or funding account cannot cover the required amount. | Check balances, fees, bonds, and account-creation fees.                  |
| Signing bundle is stale                    | The controller nonce, commitment, or deployment changed.           | Discard the bundle and create a new unsigned bundle.                     |
| Participant commitment mismatch            | The configured ordered keys do not match Mina state.               | Stop and reconcile all five keys in their exact order.                   |
| Fewer than three valid contributions       | The break-glass threshold is not met.                              | Collect valid signatures from enough distinct participant keys.          |
| Proposal toggle proof fails                | Proposal compile values are absent or do not match.                | Check the duration, three verification keys, and two empty roots.        |
| Wallet rejected the request                | The user or device did not approve the signature.                  | Review the operation and start the signing step again.                   |
| Mina rejected the transaction              | A precondition, signature, proof, or nonce is invalid.             | Read fresh Mina state before you rebuild the transaction.                |
| Inclusion wait timed out                   | Inclusion was not found in the checked chain window.               | Query Mina by transaction hash before any resubmission.                  |

## Sources

- `apps/web/features/wallet/providers/auro-wallet-client.ts`
- `apps/web/features/wallet/providers/auro-wallet-provider.ts`
- `apps/web/features/wallet/providers/ledger-wallet-provider.ts`
- `apps/web/features/ledger/lib/ledger-signing.ts`
- `apps/web/features/proposals/lib/proposal-prover-runtime.ts`
- `apps/backoffice/features/backoffice-app.tsx`
- `apps/backoffice/features/operations.ts`
- `apps/backoffice/features/prover-runtime.ts`
- `apps/backoffice/features/runtime-config.ts`
- `apps/backoffice/features/wallets.ts`
- `apps/backoffice/README.md`
- `apps/cli/src/commands/multisig-sign.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/cli/src/ledger/transaction-signer.ts`
- `apps/cli/test/ledger/README.md`
- `packages/sdk/src/signing/ledger-signing.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts`
- `devops/compose.yml`
- `devops/proxy/Caddyfile`
- `apps/docs/docs/operate/reference/cli-commands.md`
- `apps/docs/docs/operate/break-glass/index.md`
