# Ledger LocalBlockchain prototype

This test sends `o1js` transactions to `Mina.LocalBlockchain`. It uses two
explicit Ledger account indices. Index `0` is the default fee payer. Index `1`
is the default zkApp contract account. The Ledger signs both authorizations.
It then signs a contract call that increments the counter from `0` to `1`.
The test also signs and verifies a break-glass pause message field.

The prototype does not change the production CLI commands.

## Fast software test

```bash
pnpm --dir apps/cli test:ledger:software
```

This mode uses a software Ledger double. It tests commitment calculation,
o1js field serialization, signature insertion, `Transaction.fromJSON()`, and
LocalBlockchain acceptance.

## Ledger transport-mocker test

Run the non-interactive Ledger client integration test:

```bash
pnpm --dir apps/cli test:ledger:mocker
```

This mode uses Ledger's `TransportReplayer` with the real `MinaApp` TypeScript
client. A small test-only device model supplies the address and a valid field
signature. The replayer checks the exact address and field-signing APDU bytes.
The test then parses the client response and submits the signed transaction to
LocalBlockchain. It needs no Docker image, Ledger device, or user input.

This mode does not run Mina Ledger firmware and does not test the device user
interface. Use the physical-device test for that boundary.

## Docker Lightnet

Start Lightnet, then run the real network submission test:

```bash
pnpm --dir apps/cli test:ledger:lightnet
```

The test acquires a funded Lightnet account, maps it to the explicit Ledger
account index from `LEDGER_ACCOUNT_INDEX` (default `17`), submits a payment,
waits for inclusion, checks the recipient balance, and verifies a break-glass
field signature. It releases the funded account when the test ends.

## Physical Ledger

Install Mina app `1.6.7` or newer, enable blind signing, close Ledger Live,
connect and unlock the device, and open the Mina app. Then run:

```bash
LEDGER_FEE_PAYER_ACCOUNT_INDEX=0 \
LEDGER_CONTRACT_ACCOUNT_INDEX=1 \
pnpm --dir apps/cli test:ledger:device
```

Confirm both addresses and each field-signing request on the device. The test
uses only the in-process LocalBlockchain. It does not use devnet, mainnet, or
real funds. The test checks that each supplied index returns the public key used
to construct the transaction. Physical-device mode has no test-level timeout,
so it waits for each address confirmation and signing decision.

## Full CLI flow with a physical Ledger

Use this manual test to run the selected signature-producing CLI commands
against the local blockchain server. The test invokes the real CLI process for
each operation. It also prepares the voting ledgers and proofs through CLI
commands.

The test covers these command groups:

- `transfer`
- all four `multisig-sign` operations
- four signing `pause-controller` operations; standalone `deploy` is excluded
- `proposal create`, `vote`, `tally-votes`, and `execute`
- `treasury-owner deploy`, `fund-treasury`, and `emergency-withdraw`

The test compares this coverage with the current CLI command surface. It
explicitly excludes `pause-controller deploy`. It fails if another
signature-producing command does not have a test step.

The default Ledger roles use these account indices:

- `0`: transaction sender and multisig participant
- `1`: voter
- `2`: Treasury Owner deployment, emergency authorization, and multisig participant
- `3`: Treasury Owner's Pause Controller deployment and multisig participant

The four indices must be different. Install Mina app `1.6.7` or newer, enable
blind signing, close Ledger Live, connect and unlock the device, and open the
Mina app. Then run from the repository root:

```bash
pnpm --dir apps/cli test:ledger:cli-device
```

Confirm four initial address requests. Then confirm each transaction and field
signature request. The test starts its own local blockchain and archive server.
It uses no devnet, mainnet, or real funds.

The `proposal vote` command uses account `0` as the transaction sender and
account `1` as the voter. This verifies the separate Ledger account options.

The test does not supply `--proposal-private-key`. The CLI generates the
Proposal keypair in memory during `proposal create` and discards it after
deployment. The Ledger signs only the sender authorization for this command.

The sender, Treasury Owner, and Pause Controller form the multisig threshold.
Thus, all three threshold signatures also come from the physical Ledger.

Use these variables to select different Ledger account indices:

```bash
LEDGER_SENDER_ACCOUNT_INDEX=10 \
LEDGER_VOTER_ACCOUNT_INDEX=11 \
LEDGER_TREASURY_OWNER_ACCOUNT_INDEX=12 \
LEDGER_PAUSE_CONTROLLER_ACCOUNT_INDEX=13 \
pnpm --dir apps/cli test:ledger:cli-device
```

`LEDGER_CLI_DEVICE_TIMEOUT_MS` sets the timeout for each CLI command. Its
default value is `1800000` milliseconds. The complete test can take a long time
because it compiles contracts, creates proofs, and waits for device approvals.
