import { z } from "zod";
import {
  Account,
  Field,
  PrivateKey,
  Provable,
  type AuthRequired,
  FetchedAccount,
} from "o1js";

// this is how the ocaml node exports the account
export const OCamlAccountSchema = z.object({
  pk: z.string(),
  balance: z.string(),
  delegate: z.string(),
  token: z.string(),
  receipt_chain_hash: z.string(),
  voting_for: z.string(),
  permissions: z.object({
    edit_state: z.string(),
    send: z.string(),
    receive: z.string(),
    access: z.string(),
    set_delegate: z.string(),
    set_permissions: z.string(),
    set_verification_key: z.object({
      auth: z.string(),
      txn_version: z.string(),
    }),
    set_zkapp_uri: z.string(),
    edit_action_state: z.string(),
    set_token_symbol: z.string(),
    increment_nonce: z.string(),
    set_voting_for: z.string(),
    set_timing: z.string(),
  }),
  token_symbol: z.string(),
  timing: z
    .object({
      initial_minimum_balance: z.string(),
      cliff_time: z.string(),
      cliff_amount: z.string(),
      vesting_period: z.string(),
      vesting_increment: z.string(),
    })
    .optional(),
});

export type OCamlAccount = z.infer<typeof OCamlAccountSchema>;

function capitalizeIntoPermission(str: string): AuthRequired {
  if (!str) return "None" as AuthRequired;
  // not actually checking if the permission string valid, just capitalizing it
  return (str[0].toUpperCase() + str.slice(1)) as AuthRequired;
}

export function ocamlToGraphQL(rawAccount: OCamlAccount): FetchedAccount {
  const account = OCamlAccountSchema.parse(rawAccount);

  return {
    publicKey: account.pk,
    balance: {
      total: account.balance,
    },
    delegateAccount: {
      publicKey: account.delegate,
    },
    token: account.token,
    receiptChainHash: account.receipt_chain_hash,
    votingFor: account.voting_for,
    nonce: "0", // o1js
    zkappState: null, // o1js
    verificationKey: null, // o1js
    actionState: null, // o1js
    provedState: null, // o1js
    zkappUri: null, // o1js
    permissions: {
      editState: capitalizeIntoPermission(account.permissions.edit_state),
      send: capitalizeIntoPermission(account.permissions.send),
      receive: capitalizeIntoPermission(account.permissions.receive),
      access: capitalizeIntoPermission(account.permissions.access),
      setDelegate: capitalizeIntoPermission(account.permissions.set_delegate),
      setPermissions: capitalizeIntoPermission(
        account.permissions.set_permissions
      ),
      setVerificationKey: {
        auth: capitalizeIntoPermission(
          account.permissions.set_verification_key.auth
        ),
        txnVersion: account.permissions.set_verification_key.txn_version,
      },
      setZkappUri: capitalizeIntoPermission(account.permissions.set_zkapp_uri),
      editActionState: capitalizeIntoPermission(
        account.permissions.edit_action_state
      ),
      setTokenSymbol: capitalizeIntoPermission(
        account.permissions.set_token_symbol
      ),
      incrementNonce: capitalizeIntoPermission(
        account.permissions.increment_nonce
      ),
      setVotingFor: capitalizeIntoPermission(
        account.permissions.set_voting_for
      ),
      setTiming: capitalizeIntoPermission(account.permissions.set_timing),
    },
    tokenSymbol: account.token_symbol,
    timing: account.timing
      ? {
          initialMinimumBalance: account.timing.initial_minimum_balance,
          cliffTime: account.timing.cliff_time,
          cliffAmount: account.timing.cliff_amount,
          vestingPeriod: account.timing.vesting_period,
          vestingIncrement: account.timing.vesting_increment,
        }
      : undefined,
  };
}
