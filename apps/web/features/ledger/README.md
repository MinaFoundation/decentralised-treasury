# Browser Ledger signing

The browser runtime imports `@ledgerhq/hw-transport-webhid`. The shared SDK
does not import a browser or Node transport.

The Ledger wallet provider consumes these functions from
`lib/ledger-signing.ts`:

```ts
await connectLedgerAccount(accountIndex);
await signTxWithLedger(transaction, address, accountIndex);
await signFieldWithLedger(field);
```

Call either function from a user action. WebHID requires a secure browser
context and displays a device permission request.

Set both values for break-glass field signing:

```text
NEXT_PUBLIC_LEDGER_SIGNER_PUBLIC_KEY=B62...
NEXT_PUBLIC_LEDGER_SIGNER_ACCOUNT_INDEX=0
```

The wallet connection dialog collects the transaction account index. The
browser stores the selected address and index in the wallet session.

The browser does not scan or list Ledger accounts. It checks the selected
index against the connected public key before each signature.

Application transaction code uses the provider-neutral wallet controller. It
does not import this Ledger module.
