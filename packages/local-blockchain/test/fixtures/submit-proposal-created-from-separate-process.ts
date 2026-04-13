import assert from "node:assert/strict";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  TokenId,
  UInt32,
  UInt64,
  VerificationKey,
  ZkappUri,
} from "../../src/o1js.js";
import { BOND_AMOUNT_DIVISOR } from "../../../sdk/src/provable/contracts/treasury-constants.js";
import { TreasuryOwnerSmartContract } from "../../../sdk/src/provable/contracts/treasury-owner.js";
import { TreasuryPauseControllerSmartContract } from "../../../sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { TreasuryProposalSmartContract } from "../../../sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";

interface AdminStateResponse {
  ok: boolean;
  currentSlot: number;
  testAccounts: Array<{
    publicKey: string;
    privateKey: string;
    balance: string;
  }>;
}

function buildSendZkappMutation(transactionJson: string): string {
  return `mutation {
  sendZkapp(input: {
    zkappCommand: ${JSON.stringify(JSON.parse(transactionJson), null, 2).replace(
      /\"(\S+)\"\s*:/gm,
      "$1:",
    )}
  }) {
    zkapp {
      hash
      id
      failureReason {
        failures
        index
      }
    }
  }
}`;
}

async function main() {
  const minaBaseUrl = process.argv[2];
  if (!minaBaseUrl) {
    throw new Error("Expected the local blockchain base URL as the first argument");
  }

  async function readAdminState(): Promise<AdminStateResponse> {
    const response = await fetch(`${minaBaseUrl}/admin/state`);
    assert.equal(response.status, 200);
    return (await response.json()) as AdminStateResponse;
  }

  async function incrementServerSlot(by: number): Promise<void> {
    const response = await fetch(`${minaBaseUrl}/admin/slot/increment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ by }),
    });
    assert.equal(response.status, 200);
  }

  async function submitToServer(transactionJson: string) {
    const response = await fetch(`${minaBaseUrl}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: buildSendZkappMutation(transactionJson),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data?.sendZkapp?.zkapp?.failureReason ?? null, null);
    return payload.data.sendZkapp.zkapp as {
      hash: string;
      id: string;
      failureReason: null;
    };
  }

  const initialState = await readAdminState();
  const payer = initialState.testAccounts[1];
  const bondPayer = initialState.testAccounts[0];
  assert(payer, "missing payer account");
  assert(bondPayer, "missing bond payer account");

  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  local.addAccount(PublicKey.fromBase58(payer.publicKey), payer.balance);
  local.addAccount(PublicKey.fromBase58(bondPayer.publicKey), bondPayer.balance);

  const payerPrivateKey = PrivateKey.fromBase58(payer.privateKey);
  const payerPublicKey = payerPrivateKey.toPublicKey();
  const bondPayerPrivateKey = PrivateKey.fromBase58(bondPayer.privateKey);
  const bondPayerPublicKey = bondPayerPrivateKey.toPublicKey();

  TreasuryPauseControllerSmartContract.multisigParticipants = Array.from(
    { length: 5 },
    () => PrivateKey.random().toPublicKey(),
  );

  TreasuryProposalSmartContract.voteReducerVerificationKey = VerificationKey.dummySync();
  TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
    VerificationKey.dummySync();
  TreasuryProposalSmartContract.emptyNullifierRoot = Field(0);
  TreasuryProposalSmartContract.emptyVotingLedgerRoot = Field(0);
  await TreasuryProposalSmartContract.compile();

  TreasuryOwnerSmartContract.proposalContractVerificationKey =
    TreasuryProposalSmartContract._verificationKey;
  await TreasuryPauseControllerSmartContract.compile();
  await TreasuryOwnerSmartContract.compile();

  const pauseControllerPrivateKey = PrivateKey.random();
  const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const proposalPrivateKey = PrivateKey.random();
  const proposalPublicKey = proposalPrivateKey.toPublicKey();
  const recipientPublicKey = PrivateKey.random().toPublicKey();

  const pauseController = new TreasuryPauseControllerSmartContract(
    pauseControllerPublicKey,
  );
  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const proposalAmount = UInt64.from(100_000_000_000);

  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey = pauseControllerPublicKey;

  const deployPauseControllerTx = await Mina.transaction(
    { sender: payerPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(payerPublicKey, 1);
      await pauseController.deploy();
    },
  );
  deployPauseControllerTx.sign([payerPrivateKey, pauseControllerPrivateKey]);
  await deployPauseControllerTx.prove();
  await deployPauseControllerTx.send().then((pendingTx) => pendingTx.wait?.());
  await submitToServer(deployPauseControllerTx.toJSON());
  local.incrementGlobalSlot(1);
  await incrementServerSlot(1);
  local.incrementGlobalSlot(1);

  const deployTreasuryOwnerTx = await Mina.transaction(
    { sender: payerPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(payerPublicKey, 1);
      await treasuryOwner.deploy();
    },
  );
  deployTreasuryOwnerTx.sign([payerPrivateKey, treasuryOwnerPrivateKey]);
  await deployTreasuryOwnerTx.prove();
  await deployTreasuryOwnerTx.send().then((pendingTx) => pendingTx.wait?.());
  await submitToServer(deployTreasuryOwnerTx.toJSON());
  local.incrementGlobalSlot(1);
  await incrementServerSlot(1);
  local.incrementGlobalSlot(1);

  const createProposalTx = await Mina.transaction(
    { sender: payerPublicKey },
    async () => {
      AccountUpdate.fundNewAccount(payerPublicKey, 1);
      const bondPayerAccountUpdate = AccountUpdate.createSigned(bondPayerPublicKey);
      bondPayerAccountUpdate.balance.subInPlace(
        proposalAmount.div(BOND_AMOUNT_DIVISOR),
      );
      await treasuryOwner.createProposal(
        proposalPublicKey,
        {
          amount: proposalAmount,
          recipient: recipientPublicKey,
          zkAppUri: ZkappUri.from("https://example.com/proposals/1"),
        },
        UInt32.from(0),
      );
    },
  );
  createProposalTx.sign([payerPrivateKey, proposalPrivateKey, bondPayerPrivateKey]);
  await createProposalTx.prove();
  await createProposalTx.send().then((pendingTx) => pendingTx.wait?.());
  const createProposalResult = await submitToServer(createProposalTx.toJSON());
  local.incrementGlobalSlot(1);

  console.log(
    `PROPOSAL_CREATED_RESULT:${JSON.stringify({
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      treasuryOwnerTokenId: TokenId.toBase58(treasuryOwner.deriveTokenId()),
      proposalPublicKey: proposalPublicKey.toBase58(),
      proposalTokenId: TokenId.toBase58(treasuryOwner.deriveTokenId()),
      proposalTxHash: createProposalResult.hash,
      finalSlot: 5,
    })}`,
  );
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : JSON.stringify(error),
  );
  process.exit(1);
});
