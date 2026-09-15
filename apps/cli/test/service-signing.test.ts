import assert from "node:assert/strict";
import test from "node:test";
import { Field, Mina, PrivateKey, Signature, UInt32, UInt64 } from "o1js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import { SqlitePauseControllerService } from "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
  type LedgerSigningClient,
} from "@repo/sdk/src/signing/ledger-signing.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import {
  TreasuryProposalSmartContract,
  ProposalStatus,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { transactionSigningPublicKeys } from "@repo/sdk/src/services/transaction-signing.js";
import {
  createTransactionSigner,
  resolveSigningAccount,
} from "../src/ledger/transaction-signer.js";

for (const signer of ["in-memory", "ledger"] as const) {
  test(`${signer} signs deployment, proposal creation, voting, funding, and withdrawal`, async () => {
    const local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(local);
    const sender = local.testAccounts[0];
    const funding = local.testAccounts[1];
    const recipient = local.testAccounts[2];
    const owner = PrivateKey.random();
    const pause = PrivateKey.random();
    const standalonePause = PrivateKey.random();
    const proposal = PrivateKey.random();
    const participants = Array.from({ length: 5 }, () => PrivateKey.random());
    const keys = [
      sender.key,
      owner,
      pause,
      funding.key,
      standalonePause,
      proposal,
      ...participants,
    ];
    const accounts = keys.map((privateKey, ledgerAccountIndex) =>
      resolveSigningAccount({
        signer,
        label: `Account ${ledgerAccountIndex}`,
        ...(signer === "ledger"
          ? { publicKey: privateKey.toPublicKey(), ledgerAccountIndex }
          : { privateKey }),
      }),
    );
    const ledgerCalls: number[] = [];
    const ledger: LedgerSigningClient = {
      async getAddress(index) {
        return {
          publicKey: keys[index].toPublicKey().toBase58(),
          returnCode: "9000",
        };
      },
      async signFieldElement(index, network, bytes) {
        assert.equal(network, 0);
        ledgerCalls.push(index);
        const value = bytes.reduceRight((n, b) => (n << 8n) + BigInt(b), 0n);
        const signature = Signature.create(keys[index], [
          Field(value),
        ]).toJSON();
        return { field: signature.r, scalar: signature.s, returnCode: "9000" };
      },
    };
    const sign = createTransactionSigner(
      accounts,
      "devnet",
      (transaction, indices, networkId) =>
        signTransactionWithLedgerClient(
          transaction,
          ledger,
          indices,
          networkId,
        ),
    );
    const requests: string[][] = [];
    const transactionSigner: typeof sign = async (transaction) => {
      requests.push([...transactionSigningPublicKeys(transaction)]);
      return sign(transaction);
    };
    const service = new SqliteTreasuryOwnerService();
    const multisigParticipantsPublicKeys = participants.map((key) =>
      key.toPublicKey(),
    );
    await service.compile({
      proofsEnabled: false,
      lifecyclePeriodDuration: UInt32.from(48),
    });
    const result = await service.deploy({
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      treasuryOwnerPublicKey: owner.toPublicKey(),
      pauseControllerPublicKey: pause.toPublicKey(),
      transactionSigner,
      treasuryDeployedAtSlot: UInt32.from(0),
      multisigParticipantsPublicKeys,
      withdrawalPermission: "proofOrSignature",
      nonce: 0,
    });
    assert.ok(result.pauseControllerTxHash);
    assert.ok(result.treasuryOwnerTxHash);
    assert.deepEqual(requests, [
      [sender.toBase58(), pause.toPublicKey().toBase58()],
      [sender.toBase58(), owner.toPublicKey().toBase58()],
    ]);
    assert.equal(local.getAccount(sender).nonce.toBigint(), 2n);
    const proposalResult = await service.createProposal({
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      treasuryOwnerPublicKey: owner.toPublicKey(),
      proposalPublicKey: proposal.toPublicKey(),
      proposalLifecycleId: UInt32.from(0),
      recipientPublicKey: recipient,
      amount: UInt64.from(1_000_000_000),
      proposalZkappUri: "https://example.com/proposal",
      transactionSigner,
    });
    assert.ok(proposalResult.proposalTxHash);
    assert.deepEqual(requests.at(-1), [
      sender.toBase58(),
      proposal.toPublicKey().toBase58(),
    ]);
    local.setGlobalSlot(96);
    const voteResult = await service.voteProposal({
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      treasuryOwnerPublicKey: owner.toPublicKey(),
      proposalPublicKey: proposal.toPublicKey(),
      voterPublicKey: funding,
      vote: "yay",
      transactionSigner,
    });
    assert.ok(voteResult.voteTxHash);
    const proposalContract = new TreasuryProposalSmartContract(
      proposal.toPublicKey(),
      new TreasuryOwnerSmartContract(owner.toPublicKey()).deriveTokenId(),
    );
    for (const expected of [ProposalStatus.PAUSED, ProposalStatus.UNKNOWN]) {
      const field = MultisigSignature.dataTogglePauseProposal(
        proposal.toPublicKey(),
        local.getAccount(pause.toPublicKey()).nonce,
      );
      const signatures = new MultisigSignatures({
        signatures: await Promise.all(
          participants.map((key, index) =>
            signer === "ledger"
              ? signFieldWithLedgerClient(
                  field,
                  ledger,
                  key.toPublicKey(),
                  index + 6,
                )
              : Promise.resolve(Signature.create(key, [field])),
          ),
        ),
      });
      const feePayerNonce = Number(local.getAccount(sender).nonce.toBigint());
      const controllerNonce = Number(
        local.getAccount(pause.toPublicKey()).nonce.toBigint(),
      );
      assert.notEqual(feePayerNonce, controllerNonce);
      const toggleResult =
        await new SqlitePauseControllerService().togglePauseProposal({
          minaNodeUrl: "unused",
          senderPublicKey: sender,
          treasuryOwnerPublicKey: owner.toPublicKey(),
          pauseControllerPublicKey: pause.toPublicKey(),
          proposalPublicKey: proposal.toPublicKey(),
          multisigParticipantsPublicKeys,
          signatures,
          transactionSigner,
          nonce: feePayerNonce,
          ...(expected === ProposalStatus.UNKNOWN ? { controllerNonce } : {}),
        });
      assert.equal(toggleResult.nonce, String(controllerNonce));
      assert.equal(
        local.getAccount(sender).nonce.toBigint(),
        BigInt(feePayerNonce + 1),
      );
      assert.equal(
        local.getAccount(pause.toPublicKey()).nonce.toBigint(),
        BigInt(controllerNonce + 1),
      );
      assert.equal(
        proposalContract.status.get().toString(),
        expected.toString(),
      );
    }
    await service.transferToTreasury({
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      fundingPublicKey: funding,
      treasuryOwnerPublicKey: owner.toPublicKey(),
      transactionSigner,
      amount: UInt64.from(3_000_000_000),
    });
    await service.emergencyWithdraw({
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      treasuryOwnerPublicKey: owner.toPublicKey(),
      recipientPublicKey: recipient,
      amount: UInt64.from(1_000_000_000),
      transactionSigner,
    });
    assert.equal(
      local.getAccount(owner.toPublicKey()).balance.toBigInt(),
      2_100_000_000n,
    );
    const pauseResult = await new SqlitePauseControllerService().deploy({
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      pauseControllerPublicKey: standalonePause.toPublicKey(),
      multisigParticipantsPublicKeys,
      transactionSigner,
    });
    assert.ok(pauseResult.pauseControllerTxHash);
    if (signer === "ledger") {
      assert.ok(ledgerCalls.includes(1));
      assert.ok(ledgerCalls.includes(2));
      assert.ok(ledgerCalls.includes(3));
      assert.ok(ledgerCalls.includes(4));
      assert.ok(ledgerCalls.includes(5));
    } else {
      assert.deepEqual(ledgerCalls, []);
    }
  });
}
