import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import { Field, PrivateKey, UInt32, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalCreatedEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { Account } from "@repo/sdk/src/provable/account.js";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { LIFECYCLE_DATA_UNAVAILABLE_ERROR } from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const ARCHIVE_PROPOSAL_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const ARCHIVE_RECIPIENT_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const ARCHIVE_SENDER_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();

function buildProposalCreatedEvent(): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = "1";
  event.changeSequence = "1";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 77;
  event.blockTimestamp = now;
  event.eventType = "proposalCreated";
  event.txHash = "tx-proposal-created";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY,
    lifecycleId: 2,
    amount: "500000000",
    recipient: ARCHIVE_RECIPIENT_PUBLIC_KEY,
    zkAppUriHash: "123456",
    stakingEpochDataLedgerHash: "999",
    stakingEpochDataLedgerTotalCurrency: "20",
    senderPublicKey: ARCHIVE_SENDER_PUBLIC_KEY,
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

function buildProposalCreatedFieldEncodedEvent(): {
  event: ArchiveEventEntity;
  expectedProposalPublicKey: string;
  expectedSenderPublicKey: string;
} {
  const now = new Date();
  const senderPublicKey = PrivateKey.random().toPublicKey();
  const payload = new ProposalCreatedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    lifecycleId: UInt32.from(2),
    amount: UInt64.from(500_000_000),
    recipient: PrivateKey.random().toPublicKey(),
    zkAppUriHash: Field(123456),
    stakingEpochDataLedgerHash: Field(999),
    stakingEpochDataLedgerTotalCurrency: UInt64.from(20),
    proposerPublicKey: senderPublicKey,
    senderPublicKey,
  });
  const event = new ArchiveEventEntity();
  event.id = "2";
  event.changeSequence = "2";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 78;
  event.blockTimestamp = now;
  event.eventType = "proposalCreated";
  event.txHash = "tx-proposal-created-fields";
  event.accountUpdateId = "2";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    data: ProposalCreatedEvent.toFields(payload).map((field) =>
      field.toString(),
    ),
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return {
    event,
    expectedProposalPublicKey: payload.proposalPublicKey.toBase58(),
    expectedSenderPublicKey: payload.senderPublicKey.toBase58(),
  };
}

describe("ProposalCreatedEventHandler", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalEventFactEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    await dataSource.initialize();
    await dataSource.synchronize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("derives acceptance criteria using treasury balance from staking lookup", async () => {
    const event = buildProposalCreatedEvent();
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
        lifecycleId === 2 ? "10" : null,
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY,
    });
    assert.ok(proposal);

    assert.equal(proposal?.requiredParticipationBp, "1234");
    assert.equal(proposal?.requiredApprovalBp, "6789");
    assert.equal(proposal?.requiredParticipation, "55");
  });

  it("uses contract acceptance criteria for zero proposal and staking amounts", async () => {
    const event = buildProposalCreatedEvent();
    event.rawEventData = {
      ...(event.rawEventData as object),
      amount: "0",
      stakingEpochDataLedgerTotalCurrency: "0",
    } as never;
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => "1000",
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY,
    });
    assert.ok(proposal);
    assert.equal(proposal.requiredParticipationBp, "2000");
    assert.equal(proposal.requiredApprovalBp, "5100");
    assert.equal(proposal.requiredParticipation, "0");
  });

  it("decodes the current field-encoded proposalCreated payload layout", async () => {
    const { event, expectedProposalPublicKey, expectedSenderPublicKey } =
      buildProposalCreatedFieldEncodedEvent();
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => "10",
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: expectedProposalPublicKey,
    });
    assert.ok(proposal);
    assert.equal(proposal?.senderPublicKey, expectedSenderPublicKey);
    assert.equal(proposal?.requiredParticipationBp, "1234");
    assert.equal(proposal?.requiredApprovalBp, "6789");
    assert.equal(proposal?.requiredParticipation, "55");
  });

  it("projects proposalCreated when lifecycle staking data is not available", async () => {
    const event = buildProposalCreatedEvent();
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: "treasury-owner-public-key",
      stakingLedgerServices: {
        getService: async () => {
          throw new Error(LIFECYCLE_DATA_UNAVAILABLE_ERROR);
        },
      },
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY,
    });
    assert.ok(proposal);
    assert.equal(proposal?.requiredParticipationBp, null);
    assert.equal(proposal?.requiredApprovalBp, null);
    assert.equal(proposal?.requiredParticipation, null);
  });

  it("projects proposalCreated when the treasury account is absent from the lifecycle's staking ledger", async () => {
    const event = buildProposalCreatedEvent();
    const treasuryOwnerPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey,
      stakingLedgerServices: {
        getService: async () =>
          ({
            getRootHash: async () => Field(999),
            getAccountByPublicKey: async () => null,
            getAllAccounts: async () => [],
          }) as never,
      },
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const proposal = await dataSource.getRepository(ProposalEntity).findOneBy({
      proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY,
    });
    assert.ok(proposal);
    assert.equal(proposal.requiredParticipationBp, null);
    assert.equal(proposal.requiredApprovalBp, null);
    assert.equal(proposal.requiredParticipation, null);
  });

  it("rejects a local staking ledger whose root does not match the creation event", async () => {
    const event = buildProposalCreatedEvent();
    let accountLookups = 0;
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: "treasury-owner-public-key",
      stakingLedgerServices: {
        getService: async () =>
          ({
            getRootHash: async () => ({ toString: () => "different-root" }),
            getAccountByPublicKey: async () => {
              accountLookups += 1;
              return null;
            },
          }) as never,
      },
    });

    await assert.rejects(
      dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      /staking ledger root mismatch.*expected=999 actual=different-root/,
    );
    assert.equal(accountLookups, 0);
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 0);
  });

  it("uses the default-token treasury account when the public-key index selects a custom token", async () => {
    const event = buildProposalCreatedEvent();
    const treasuryOwnerPublicKey = PrivateKey.random().toPublicKey();
    const customTokenAccount = Account.empty();
    customTokenAccount.pk = treasuryOwnerPublicKey;
    customTokenAccount.tokenId = Field(8_001);
    customTokenAccount.balance = UInt64.from(999);
    const defaultTokenAccount = Account.empty();
    defaultTokenAccount.pk = treasuryOwnerPublicKey;
    defaultTokenAccount.balance = UInt64.from(123);
    let observedTreasuryBalance: string | null = null;
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      stakingLedgerServices: {
        getService: async () =>
          ({
            getRootHash: async () => Field(999),
            getAccountByPublicKey: async () => ({
              index: 0n,
              account: customTokenAccount,
            }),
            getAllAccounts: async () => [
              customTokenAccount,
              defaultTokenAccount,
            ],
            getWitness: async (index: bigint) => {
              assert.equal(index, 1n);
              return {
                calculateRoot: () => Field(999),
              };
            },
          }) as never,
      },
      deriveAcceptanceCriteria: async ({ treasuryBalance }) => {
        observedTreasuryBalance = treasuryBalance;
        return {
          requiredParticipationBp: "1",
          requiredApprovalBp: "2",
          requiredParticipation: "3",
        };
      },
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(observedTreasuryBalance, "123");
  });

  it("rejects a staking ledger that has no default-token treasury account", async () => {
    const event = buildProposalCreatedEvent();
    const treasuryOwnerPublicKey = PrivateKey.random().toPublicKey();
    const customTokenAccount = Account.empty();
    customTokenAccount.pk = treasuryOwnerPublicKey;
    customTokenAccount.tokenId = Field(8_002);
    customTokenAccount.balance = UInt64.from(999);
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      stakingLedgerServices: {
        getService: async () =>
          ({
            getRootHash: async () => Field(999),
            getAccountByPublicKey: async () => ({
              index: 0n,
              account: customTokenAccount,
            }),
            getAllAccounts: async () => [customTokenAccount],
            getWitness: async () => ({
              calculateRoot: () => Field(999),
            }),
          }) as never,
      },
    });

    await assert.rejects(
      dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      /exactly one default-token treasury account.*found=0/,
    );
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });

  it("rejects a treasury balance row that is not bound to the staking root", async () => {
    const event = buildProposalCreatedEvent();
    const treasuryOwnerPublicKey = PrivateKey.random().toPublicKey();
    const defaultTokenAccount = Account.empty();
    defaultTokenAccount.pk = treasuryOwnerPublicKey;
    defaultTokenAccount.balance = UInt64.from(123);
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      stakingLedgerServices: {
        getService: async () =>
          ({
            getRootHash: async () => Field(999),
            getAccountByPublicKey: async () => ({
              index: 0n,
              account: defaultTokenAccount,
            }),
            getWitness: async () => ({
              calculateRoot: () => Field(998),
            }),
          }) as never,
      },
    });

    await assert.rejects(
      dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      /treasury account witness does not match staking ledger root/,
    );
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });

  it("preserves root-bound criteria when a pending creation becomes canonical", async () => {
    const event = buildProposalCreatedEvent();
    event.status = "pending";
    const treasuryOwnerPublicKey = PrivateKey.random().toPublicKey();
    const defaultTokenAccount = Account.empty();
    defaultTokenAccount.pk = treasuryOwnerPublicKey;
    defaultTokenAccount.balance = UInt64.from(123);
    let localRoot = "999";
    let serviceLookups = 0;
    const handler = new ProposalCreatedEventHandler({
      treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
      stakingLedgerServices: {
        getService: async () => {
          serviceLookups += 1;
          return {
            getRootHash: async () => Field(localRoot),
            getAccountByPublicKey: async () => ({
              index: 0n,
              account: defaultTokenAccount,
            }),
            getWitness: async () => ({
              calculateRoot: () => Field(999),
            }),
          } as never;
        },
      },
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(serviceLookups, 1);

    localRoot = "998";
    event.status = "canonical";
    event.changeSequence = "2";
    event.updatedAt = new Date(event.updatedAt.getTime() + 1_000);
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(serviceLookups, 1);

    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY });
    assert.equal(proposal.creationObservationStatus, "canonical");
    assert.equal(proposal.requiredParticipationBp, "1234");
    assert.equal(proposal.requiredApprovalBp, "6789");
    assert.equal(proposal.requiredParticipation, "55");

    event.status = "orphaned";
    event.changeSequence = "3";
    event.updatedAt = new Date(event.updatedAt.getTime() + 1_000);
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(serviceLookups, 1);
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY }),
      0,
    );
  });

  it("does not let unavailable lifecycle data block a creation orphan rollback", async () => {
    const event = buildProposalCreatedEvent();
    event.status = "pending";
    let lifecycleDataAvailable = true;
    let balanceLookups = 0;
    const handler = new ProposalCreatedEventHandler({
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
      resolveTreasuryBalanceForLifecycle: async () => {
        balanceLookups += 1;
        if (!lifecycleDataAvailable) {
          throw new Error(LIFECYCLE_DATA_UNAVAILABLE_ERROR);
        }
        return "123";
      },
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(balanceLookups, 1);

    lifecycleDataAvailable = false;
    event.status = "orphaned";
    event.changeSequence = "2";
    event.updatedAt = new Date(event.updatedAt.getTime() + 1_000);
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(balanceLookups, 1);
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY }),
      0,
    );
    const fact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneByOrFail({ archiveEventId: event.id });
    assert.equal(fact.status, "orphaned");
    assert.equal(fact.decodedPayload.requiredParticipationBp, "1234");
  });

  it("records a first-seen creation orphan without lifecycle data", async () => {
    const event = buildProposalCreatedEvent();
    event.status = "orphaned";
    let balanceLookups = 0;
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => {
        balanceLookups += 1;
        throw new Error(LIFECYCLE_DATA_UNAVAILABLE_ERROR);
      },
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(balanceLookups, 0);
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 0);
    const fact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneByOrFail({ archiveEventId: event.id });
    assert.equal(fact.status, "orphaned");
    assert.equal(fact.decodedPayload.requiredParticipationBp, null);
  });

  it("derives root-bound criteria when a first-seen creation orphan becomes active", async () => {
    const event = buildProposalCreatedEvent();
    event.status = "orphaned";
    let balanceLookups = 0;
    const handler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => {
        balanceLookups += 1;
        return "123";
      },
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "1234",
        requiredApprovalBp: "6789",
        requiredParticipation: "55",
      }),
    });

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(balanceLookups, 0);

    event.status = "pending";
    event.changeSequence = "2";
    event.updatedAt = new Date(event.updatedAt.getTime() + 1_000);
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );
    assert.equal(balanceLookups, 1);

    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey: ARCHIVE_PROPOSAL_PUBLIC_KEY });
    assert.equal(proposal.creationObservationStatus, "pending");
    assert.equal(proposal.requiredParticipationBp, "1234");
    assert.equal(proposal.requiredApprovalBp, "6789");
    assert.equal(proposal.requiredParticipation, "55");
  });

  it("rejects compatibility payload values outside contract domains", async () => {
    const event = buildProposalCreatedEvent();
    event.rawEventData = {
      ...(event.rawEventData as object),
      amount: "18446744073709551616",
    } as never;
    const handler = new ProposalCreatedEventHandler();

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      false,
    );
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });

  it("rejects field-encoded values that do not satisfy contract type checks", async () => {
    const handler = new ProposalCreatedEventHandler();
    const cases: Array<{ label: string; mutate(data: string[]): void }> = [
      {
        label: "UInt32 lifecycle overflow",
        mutate: (data) => {
          data[2] = "4294967296";
        },
      },
      {
        label: "UInt64 amount overflow",
        mutate: (data) => {
          data[3] = "18446744073709551616";
        },
      },
      {
        label: "UInt64 staking total overflow",
        mutate: (data) => {
          data[8] = "18446744073709551616";
        },
      },
      {
        label: "non-Boolean public-key parity",
        mutate: (data) => {
          data[1] = "2";
        },
      },
      {
        label: "proposer differs from the contract sender",
        mutate: (data) => {
          const differentProposer = PrivateKey.random().toPublicKey();
          data.splice(
            9,
            2,
            ...differentProposer.toFields().map((field) => field.toString()),
          );
        },
      },
    ];

    for (const testCase of cases) {
      const { event } = buildProposalCreatedFieldEncodedEvent();
      const data = (event.rawEventData as { data: string[] }).data;
      testCase.mutate(data);
      assert.equal(
        await dataSource.transaction(
          async (manager) => await handler.tryHandle(event, manager),
        ),
        false,
        testCase.label,
      );
    }
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });
});
