import { PrivateKey, Account } from "o1js";
import fs from "fs";

function getAccount() {
  return {
    pk: PrivateKey.random().toPublicKey().toBase58(),
    balance: `${Math.floor(Math.random() * 1000000)}`,
    delegate: PrivateKey.random().toPublicKey().toBase58(),
    timing: {
      initial_minimum_balance: "1000",
      cliff_time: "10",
      cliff_amount: "100",
      vesting_period: "20",
      vesting_increment: "100",
    },
    token: "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf",
    receipt_chain_hash: "2mzbV7WevxLuchs2dAMY4vQBS6XttnCUF8Hvks4XNBQ5qiSGGBQe",
    voting_for: "3NK2tkzqqK5spR2sZ7tujjqPksL45M3UUrcA4WhCkeiPtnugyE2x",
    permissions: {
      edit_state: "signature",
      send: "signature",
      receive: "none",
      access: "none",
      set_delegate: "signature",
      set_permissions: "signature",
      set_verification_key: { auth: "signature", txn_version: "3" },
      set_zkapp_uri: "signature",
      edit_action_state: "signature",
      set_token_symbol: "signature",
      increment_nonce: "signature",
      set_voting_for: "signature",
      set_timing: "signature",
    },
    token_symbol: "",
  };
}

export async function createTestAccounts(numberOfAccounts: number) {
  console.log(`Creating ${numberOfAccounts} accounts...`);
  const accounts: any[] = [];

  for (let i = 0; i < numberOfAccounts; i++) {
    accounts.push(getAccount());

    const interval =
      numberOfAccounts >= 100000
        ? 10000
        : numberOfAccounts >= 10000
          ? 1000
          : numberOfAccounts >= 1000
            ? 100
            : 10;

    if (i % interval === 0 && i > 0) {
      console.log(`Created ${i} accounts...`);
    }
  }

  return accounts;
}
