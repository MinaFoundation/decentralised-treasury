---
title: Vote
sidebar_label: Vote
sidebar_position: 6
audience: user
page_kind: procedure
---

Users can vote `yay`, `nay`, or `abstain` during the Voting period.
Each vote requires the voter signature.

## Voting Weight

Voting weight comes from the staking ledger recorded when the proposal was created.
The proof process groups default-token stake by delegate public key.

A voter key has weight when it is a delegate key in the selected voting ledger.
The web application shows the connected wallet's available voting weight.

Later staking or delegation changes do not change this recorded snapshot.
They can affect a later lifecycle that records a different snapshot.

## Vote Choices

- `yay` supports the proposal.
- `nay` opposes the proposal.
- `abstain` adds weight to participation without adding approval or opposition weight.

The first counted vote from a voter key uses that key's weight.
Later votes from the same key do not add voting weight.

## Before You Vote

Check these conditions:

- The proposal is in the Voting period.
- The treasury is not globally paused.
- The proposal is not `PAUSED`.
- The connected wallet is the voter key.
- The voter account exists on the Mina network.
- The fee payer has enough MINA for the transaction fee.
- You independently matched the exact Markdown to the Proposal account `zkappUri`.
- The recipient and amount are correct.

## Verify the Proposal Content

The App API hashes submitted Markdown and compares it with the processor projection.
The web application marks available stored content as verified by this projection check.
It does not query the Proposal account for an independent content check.

Use the raw `contents` value or the original Markdown file.
Do not hash rendered HTML or text copied from the rendered page.

Use this workflow before a material vote:

1. Save the exact Markdown bytes to a local file.
2. Calculate the SHA-256 digest of that file.
3. Add the prefix `urn:proposal-content:markdown:sha256:` to the digest.
4. Read the Treasury Owner token ID with `treasury-owner read-state`.
5. Query the Proposal token account `zkappUri` from Mina GraphQL.
6. Compare the two complete `zkappUri` strings.

The following commands show the comparison:

```bash
CONTENT_DIGEST=$(openssl dgst -sha256 -r "$PROPOSAL_MARKDOWN_PATH" | awk '{print $1}')
EXPECTED_ZKAPP_URI="urn:proposal-content:markdown:sha256:${CONTENT_DIGEST}"

OWNER_STATE=$(pnpm run cli -- treasury-owner read-state \
  --mina-node-url "$MINA_NODE_URL" \
  --network-id "$MINA_NETWORK_ID" \
  --treasury-owner-public-key "$TREASURY_OWNER_PUBLIC_KEY")
PROPOSAL_TOKEN_ID=$(printf '%s' "$OWNER_STATE" | jq -r '.treasuryOwnerTokenId')

CHAIN_ZKAPP_URI=$(jq -n \
  --arg publicKey "$PROPOSAL_PUBLIC_KEY" \
  --arg token "$PROPOSAL_TOKEN_ID" \
  '{query:"query ProposalContent($publicKey: String!, $token: String!) { account(publicKey: $publicKey, token: $token) { zkappUri } }", variables:{publicKey:$publicKey, token:$token}}' \
  | curl -fsS -X POST "$MINA_NODE_URL" \
      -H 'content-type: application/json' \
      --data-binary @- \
  | jq -r '.data.account.zkappUri')

test "$EXPECTED_ZKAPP_URI" = "$CHAIN_ZKAPP_URI"
```

The final command must exit successfully.
Do not vote when the values differ or the Mina account query fails.

## Vote in the Web Application

1. Connect the voter wallet.
2. Open the proposal.
3. Read the proposal content and details.
4. Find the **Voting** section.
5. Select **Yay**, **Nay**, or **Abstain**.
6. Review the vote and fee.
7. Compile and prove the transaction.
8. Approve the wallet signature.
9. Wait for transaction inclusion.
10. Save the transaction hash.

The web application blocks its vote buttons when the connected wallet has zero displayed weight.
The contract can still receive a signed action from a zero-weight key.

## After You Vote

The application can take time to show a new vote.
The indexer and processor must first read and project the event.

A visible vote event is not the final result.
The operator must reduce the actions and submit the tally after voting ends.

## Next Step

Wait for the operator to submit a successful tally. Then follow
[Results and Acceptance](results-and-acceptance.md). Do not execute a proposal
only because its votes appear sufficient.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `vote`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `vote`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts` — `Vote`, `VoteAction`, `VoteReducer`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts` — delegate-based voting accounts
- `packages/sdk/src/utils/proposal-content-hash.ts` — Markdown commitment format
- `apps/api/src/proposal-content-routes.ts` — projection-based content check
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx` — web vote transaction flow
- `packages/ui/src/treasury/proposals/proposal-detail.tsx` — vote controls and displayed voting weight
