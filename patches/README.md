# Pinned dependency patches

## Ledger WebHID 6.36.0

`@ledgerhq__hw-transport-webhid@6.36.0.patch` fixes pending reads after a device disconnect.
It also removes event listeners, releases the exchange lock, and makes close idempotent.
A fresh transport can reconnect to the same device.

The patch keeps MinaApp error-result semantics and the package version unchanged.
It includes the TypeScript source, both JavaScript module forms, and regenerated JavaScript source maps.
It does not add a general deadline for a permanently pending browser write.

The Web Ledger tests use the real transport and MinaApp with a simulated HID device.
Physical Ledger checks remain a separate manual lane.

Use pnpm 9's pinned-package patch workflow when updating this patch.
Commit the patch, root patch metadata, and lockfile together.
The ordered E2E source manifest must hash the patch bytes. Patch edits must also trigger CI.
