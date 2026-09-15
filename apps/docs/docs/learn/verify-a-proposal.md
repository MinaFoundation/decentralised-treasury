---
title: Verify A Proposal
sidebar_label: Verify a proposal
audience: user
page_kind: procedure
---

# Verify A Proposal

This procedure compares the exact stored Markdown with the Proposal account on Mina.
It also shows how to read Proposal state without submitting a transaction.
The application content badge checks a processor projection. It does not perform this independent comparison.

## Prepare The Inputs

Complete [Required command tools](../developer/local-development/tools.md), including workspace dependency installation.
Open a Bash terminal at the repository root. Use the same terminal for all blocks below.
No wallet connection or signing key is required.

Obtain the endpoints and Owner address from your [confirmed deployment record](check-your-deployment.md).
Copy the Proposal public key from its detail page.
Set these public values. Replace every example value before running the checks:

```bash
set -euo pipefail
export TREASURY_API_URL='https://<APP_HOST>/api'
export MINA_NODE_URL='https://<APP_HOST>/mina/graphql'
export MINA_NETWORK_ID='<devnet|mainnet|testnet>'
export TREASURY_OWNER_PUBLIC_KEY='<OWNER_PUBLIC_KEY>'
export PROPOSAL_PUBLIC_KEY='<PROPOSAL_PUBLIC_KEY>'
export LIFECYCLE_PERIOD_DURATION='<DURATION_FROM_RECORD>'
VERIFY_DIRECTORY=$(mktemp -d)
PROPOSAL_MARKDOWN_PATH="$VERIFY_DIRECTORY/proposal.md"
```

`TREASURY_API_URL` is the App API base URL, including `/api` when the deployment uses that proxy path.
`MINA_NODE_URL` is the complete GraphQL URL.
The contract duration matters for decoded timing. Do not use a default when the deployment record gives another value.

## Download Exact Markdown

```bash
curl --fail-with-body --silent --show-error \
  "$TREASURY_API_URL/proposals/$PROPOSAL_PUBLIC_KEY" \
  -o "$VERIFY_DIRECTORY/proposal.json"

jq -e --arg key "$PROPOSAL_PUBLIC_KEY" \
  '.proposalPublicKey == $key and (.contents | type == "string" and length > 0)' \
  "$VERIFY_DIRECTORY/proposal.json"

jq -j '.contents' "$VERIFY_DIRECTORY/proposal.json" > "$PROPOSAL_MARKDOWN_PATH"
```

The first `jq` command must print `true`. A missing or null `contents` value is not verifiable content.
The `-j` option writes the decoded string without adding a newline.
It preserves any newline already present in the string.
Do not copy rendered HTML or resave the file in an editor before hashing it.

## Derive The Proposal Token ID

Proposal accounts use the Owner's custom token. A query for the default token can select the wrong account.
Derive the Base58 token ID locally with the installed o1js package:

```bash
PROPOSAL_TOKEN_ID=$(node --input-type=module -e '
  import { PublicKey, TokenId } from "o1js";
  const owner = PublicKey.fromBase58(process.env.TREASURY_OWNER_PUBLIC_KEY);
  console.log(TokenId.toBase58(TokenId.derive(owner)));
')
```

This calculation does not query Mina or generate a proof.
The CLI Owner state field `treasuryOwnerTokenId` is decimal. Do not pass that decimal value directly to GraphQL.

## Query Mina And Compare

```bash
jq -n --arg publicKey "$PROPOSAL_PUBLIC_KEY" --arg token "$PROPOSAL_TOKEN_ID" \
  '{query:"query ProposalContent($publicKey: String!, $token: String!) { account(publicKey: $publicKey, token: $token) { publicKey token zkappUri } }", variables:{publicKey:$publicKey, token:$token}}' \
  > "$VERIFY_DIRECTORY/query.json"

curl --fail-with-body --silent --show-error \
  -H 'content-type: application/json' \
  --data-binary @"$VERIFY_DIRECTORY/query.json" \
  "$MINA_NODE_URL" -o "$VERIFY_DIRECTORY/chain.json"

jq -e --arg key "$PROPOSAL_PUBLIC_KEY" --arg token "$PROPOSAL_TOKEN_ID" \
  '((.errors // []) | length == 0) and .data.account != null and .data.account.publicKey == $key and .data.account.token == $token and (.data.account.zkappUri | type == "string" and length > 0)' \
  "$VERIFY_DIRECTORY/chain.json"

CONTENT_DIGEST=$(openssl dgst -sha256 -r "$PROPOSAL_MARKDOWN_PATH" | awk '{print $1}')
EXPECTED_ZKAPP_URI="urn:proposal-content:markdown:sha256:${CONTENT_DIGEST}"
CHAIN_ZKAPP_URI=$(jq -r '.data.account.zkappUri' "$VERIFY_DIRECTORY/chain.json")

if [ "$EXPECTED_ZKAPP_URI" = "$CHAIN_ZKAPP_URI" ]; then
  printf '%s\n' 'MATCH: exact Markdown matches the queried Proposal account.'
else
  printf '%s\n' 'MISMATCH: stop before voting.' >&2
  exit 1
fi
```

Continue only after the query check prints `true` and the comparison prints `MATCH`.
An HTTP `200` response with a GraphQL `errors` array is a failed check.
A matching commitment establishes content integrity for this account. It does not establish the quality of the request.

## Check State And An Uncertain Result

Read the Proposal directly through the repository CLI:

```bash
LOG_LEVEL=silent pnpm --silent --dir apps/cli run mina-treasury -- proposal read-state \
  --treasury-owner-public-key "$TREASURY_OWNER_PUBLIC_KEY" \
  --proposal-public-key "$PROPOSAL_PUBLIC_KEY" \
  --mina-node-url "$MINA_NODE_URL" \
  --network-id "$MINA_NETWORK_ID"
```

Compare `status`, `paidOutAmount`, the requested amount, and lifecycle with the application.
Use [Results and acceptance](results-and-acceptance.md) to interpret the status.
For an execution, also compare the recipient balance and the requested payout.

Keep the transaction hash from submission. Set `TX_HASH` to that hash and query the recent chain:

```bash
TX_HASH='<TRANSACTION_HASH>'
jq -n '{query:"query { bestChain(maxLength: 20) { transactions { zkappCommands { hash failureReason { index failures } } } } }"}' \
  > "$VERIFY_DIRECTORY/inclusion-query.json"
curl --fail-with-body --silent --show-error \
  -H 'content-type: application/json' \
  --data-binary @"$VERIFY_DIRECTORY/inclusion-query.json" \
  "$MINA_NODE_URL" -o "$VERIFY_DIRECTORY/inclusion.json"
jq -e '((.errors // []) | length == 0) and (.data.bestChain | type == "array")' \
  "$VERIFY_DIRECTORY/inclusion.json"
jq --arg hash "$TX_HASH" \
  '[.data.bestChain[].transactions.zkappCommands[]? | select(.hash == $hash)]' \
  "$VERIFY_DIRECTORY/inclusion.json"
```

A matching entry with no `failureReason` reports inclusion without a recorded failure in that observed chain.
A nonempty failure list reports a failed transaction. An empty result means this query did not find the transaction.
This search covers only 20 recent blocks. Absence does not prove rejection or justify resubmission.
Ask the operator for a historical transaction lookup when the transaction is older.
A current state read does not identify which transaction caused the state.
Inclusion in one observed chain does not guarantee finality.
If inclusion remains uncertain, give the hash and saved queries to the operator before any retry.
Ask for a second Mina provider when the first provider is unavailable or gives conflicting state.

## Failed Check Examples

| Observed result                       | Action                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| HTTP `404` or null Markdown           | Confirm the Proposal key and wait for content availability. Contact the operator if it remains unavailable. |
| GraphQL errors or null account        | Check the network, endpoint, Owner address, and derived token ID. Do not treat this as a match.             |
| One extra newline produces `MISMATCH` | Download the raw `contents` again. Do not modify the committed Markdown to force agreement.                 |
| API and Mina show different status    | Keep both responses and their observation times. Ask the operator to reconcile the projection.              |

Keep the files in `VERIFY_DIRECTORY` until the result is resolved.
The stored responses reflect the times when each endpoint answered. They are not an atomic historical snapshot.

## Sources

- `apps/api/src/proposal-list-routes.ts`
- `apps/api/src/proposal-content-routes.ts`
- `packages/sdk/src/utils/proposal-content-hash.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/bin/mina-treasury.cjs`
- `apps/web/features/proposals/lib/transaction-inclusion.ts`
