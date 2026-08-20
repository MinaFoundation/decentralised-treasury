# Ledger LocalBlockchain prototype

This test sends `o1js` transactions to `Mina.LocalBlockchain`. It derives two
separate Ledger accounts. The first account is the fee payer. The second account
is the zkApp contract account. The Ledger signs both deployment authorizations.
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

## Physical Ledger

Install Mina app `1.6.7` or newer, enable blind signing, close Ledger Live,
connect and unlock the device, and open the Mina app. Then run:

```bash
pnpm --dir apps/cli test:ledger:device
```

Confirm both addresses and each field-signing request on the device. The test
uses only the in-process LocalBlockchain. It does not use devnet, mainnet, or
real funds. The test derives the first two Mina Ledger accounts internally. It
does not ask for an account index and it has no account-index environment
variable.
