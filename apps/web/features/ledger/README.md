# Browser Ledger signing

The browser runtime imports `@ledgerhq/hw-transport-webhid`. The shared SDK
does not import a browser or Node transport.

Application transaction code consumes only these functions from
`lib/ledger-signing.ts`:

```ts
await signTxWithLedger(transaction);
await signFieldWithLedger(field);
```

Call either function from a user action. WebHID requires a secure browser
context and displays a device permission request.

Set `NEXT_PUBLIC_LEDGER_SIGNER_PUBLIC_KEY` for break-glass field signing.
Transaction signing reads all required public keys from the zkApp command.
