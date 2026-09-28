---
title: Shortened Treasury events
sidebar_label: Shortened events
audience: operator
page_kind: procedure
---

# Shortened Treasury events

Use this procedure when a shortened event blocks the proposal processor.
The decoder fix restores supported events with one missing final zero.
The decoder needs no contract change. Event quarantine requires the database migration included in this release.

## Identify the failure

Older processor versions block the cursor after five failed attempts.
The current processor quarantines events that no handler can decode.
It retains the event snapshot and advances the cursor atomically.
Temporary handler and database failures still use bounded retries and blocking.

All five current Treasury Owner event arrays have an even field count, including the discriminator.
Each array ends with the sender public key parity field.
Removing a final zero preserves the event commitment and serialized AccountUpdate hash.
The old decoder did not handle this form correctly.

Check the stored raw event, its type, and the processor failure before recovery.
A missing final field is supported only when that field can be restored as zero under the current schema.
Do not apply this recovery by changing the stored raw event.

## Decoder behavior

The decoder validates the discriminator against the expected event type.
It obtains the payload width from the current SDK event schema.
It accepts a complete array, or one missing final field when the complete array has even width.
For the shortened form, it removes the discriminator and appends zero to a new payload array.
It keeps the stored Archive data unchanged.

The handlers retain their field, public key, integer, Boolean, and enum checks.
Malformed raw data cannot fall back to named payload properties.
The decoder rejects stripped field arrays and the old execution layout with a recipient field.
The named-payload path, used when no raw field array exists, is unchanged.

## Deployment and recovery

1. Apply the database migrations, then deploy the corrected processor build.
2. Check the processor status and stored failure snapshot.
3. Stop the processor worker before a manual recovery run.
4. Run the blocked-event retry command with the deployment environment:

   ```bash
   pnpm --filter @repo/api processor:retry-blocked
   ```

5. Restart the processor worker.
6. Confirm that the failure is resolved and the cursor advances through later events.

Do not delete the event or manually advance the cursor.
Keep the original Archive snapshot for diagnosis.
If the retry fails, preserve the new failure details and investigate the remaining decoding or handler error.

## Other invalid events

The processor stores undecodable events with state `quarantined` in `processor_event_failures`.
It rolls back failed handler writes before saving the snapshot and cursor together.
Later valid events continue through normal processing and projection replay.
Operational errors remain retryable. They are not classified as invalid events.

The status endpoint reports incomplete data while quarantine records remain unresolved.
Do not use affected projections as an authoritative account of chain state.
Inspect the saved snapshot and compare it with trusted Archive data.
A corrected observation at a newer change sequence is processed normally and supersedes the earlier quarantine record.
If the decoder needs a change, rebuild the projection from verified source events after applying that change.
Do not delete failure records or manually mark them resolved without reconciling the projection.
The blocked-event retry command does not replay quarantined records behind the cursor.

## Sources

- `apps/api/src/processors/proposals/proposal-event-decoding.ts`
- `apps/api/src/processors/proposals/proposal-executed-event-handler.ts`
- `apps/api/test/proposal-shortened-event.test.ts`
- `apps/api/test/proposal-archive-status-pipeline.test.ts`
- `apps/api/package.json`
