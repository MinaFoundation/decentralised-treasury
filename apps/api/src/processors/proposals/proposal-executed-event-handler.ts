import type { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import { BOND_AMOUNT_DIVISOR } from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import type { EntityManager } from "typeorm";
import { ProposalExecutionEntity } from "./proposal-execution-entity.js";
import { ProposalEntity } from "./proposal-entity.js";

const PROPOSAL_EXECUTED_EVENT_NAME = "proposalExecuted";

interface DecodedProposalExecutedPayload {
  proposalPublicKey: string;
  amountToPayOut: string;
  senderPublicKey: string;
}

function parseLifecycleId(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      return null;
    }
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }
  return null;
}

function decodeArchiveProvidedPayload(
  event: ArchiveEventEntity,
): DecodedProposalExecutedPayload | null {
  const candidate = event.rawEventData as {
    proposalPublicKey?: unknown;
    amountToPayOut?: unknown;
    senderPublicKey?: unknown;
  };
  if (
    typeof candidate.proposalPublicKey !== "string" ||
    typeof candidate.amountToPayOut !== "string" ||
    typeof candidate.senderPublicKey !== "string"
  ) {
    return null;
  }

  return {
    proposalPublicKey: candidate.proposalPublicKey,
    amountToPayOut: candidate.amountToPayOut,
    senderPublicKey: candidate.senderPublicKey,
  };
}

async function decodeProposalExecutedPayload(
  event: ArchiveEventEntity,
): Promise<DecodedProposalExecutedPayload | null> {
  const archiveProvidedPayload = decodeArchiveProvidedPayload(event);
  if (archiveProvidedPayload) {
    return archiveProvidedPayload;
  }

  const data = event.rawEventData.data;
  if (!Array.isArray(data)) {
    return null;
  }
  if (
    event.eventType &&
    event.eventType !== "unknown" &&
    event.eventType !== PROPOSAL_EXECUTED_EVENT_NAME
  ) {
    return null;
  }

  try {
    const o1jsModuleName = "o1js";
    const proposalEventsModuleName =
      "@repo/sdk/src/provable/events/treasury-proposal-events.js";
    const [o1jsModule, proposalEventsModule] = await Promise.all([
      import(o1jsModuleName),
      import(proposalEventsModuleName),
    ]);
    const { Field, PublicKey, UInt64 } = o1jsModule as {
      Field: (value: string) => unknown;
      PublicKey: {
        fromFields(values: unknown[]): { toBase58(): string };
      };
      UInt64: {
        fromFields(values: unknown[]): { toString(): string };
      };
    };
    if (data.length === 7) {
      return {
        proposalPublicKey: PublicKey.fromFields(
          data.slice(0, 2).map((value) => Field(value)),
        ).toBase58(),
        amountToPayOut: UInt64.fromFields([Field(data[4])]).toString(),
        senderPublicKey: PublicKey.fromFields(data.slice(5, 7).map((value) => Field(value))).toBase58(),
      };
    }
    const ProposalExecutedEvent = (
      proposalEventsModule as {
        ProposalExecutedEvent: {
          fromFields(values: unknown[]): {
            proposalPublicKey: { toBase58(): string };
            amountToPayOut: { toString(): string };
            senderPublicKey: { toBase58(): string };
          };
        };
      }
    ).ProposalExecutedEvent;
    const decoded = ProposalExecutedEvent.fromFields(
      data.map((value) => Field(value)),
    );
    return {
      proposalPublicKey: decoded.proposalPublicKey.toBase58(),
      amountToPayOut: decoded.amountToPayOut.toString(),
      senderPublicKey: decoded.senderPublicKey.toBase58(),
    };
  } catch (error) {
    console.error(
      `[proposal-processor] failed to decode proposalExecuted event id=${event.id}`,
      error,
    );
    return null;
  }
}

export class ProposalExecutedEventHandler implements EventProcessorHandler {
  public readonly eventType = PROPOSAL_EXECUTED_EVENT_NAME;

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const payload = await decodeProposalExecutedPayload(event);
    if (!payload) {
      return false;
    }

    const proposalRepository = manager.getRepository(ProposalEntity);
    const proposal = await proposalRepository.findOneBy({
      proposalPublicKey: payload.proposalPublicKey,
    });
    if (!proposal) {
      // Same reasoning as the vote handler: the proposalCreated event was never
      // indexed, so this execution cannot be projected. Returning false would
      // send the event round every other handler and then leave it unhandled,
      // which the processor turns into a throw and a full batch rollback.
      console.warn(
        `[proposal-processor] proposal row missing for proposalPublicKey=${payload.proposalPublicKey}; skipping execution event id=${event.id}`,
      );
      return true;
    }
    const proposalAmount = BigInt(proposal.amount);
    const bondAmount = proposalAmount / BigInt(BOND_AMOUNT_DIVISOR);
    const totalPayoutAmount = proposalAmount + bondAmount;

    const executionRepository = manager.getRepository(ProposalExecutionEntity);
    await executionRepository.upsert(
      {
        archiveEventId: event.id,
        proposalPublicKey: payload.proposalPublicKey,
        lifecycleId: proposal.lifecycleId,
        recipient: proposal.recipient,
        amountToPayOut: payload.amountToPayOut,
        proposalAmount: proposal.amount,
        bondAmount: bondAmount.toString(),
        senderPublicKey: payload.senderPublicKey,
        paidOutAmount: "0",
        remainingAmount: totalPayoutAmount.toString(),
        blockHeight: event.blockHeight ?? null,
        status: event.status,
      },
      ["archiveEventId"],
    );

    const executionRows = await executionRepository.find({
      where: {
        proposalPublicKey: payload.proposalPublicKey,
      },
      order: {
        blockHeight: "ASC",
        id: "ASC",
      },
    });

    let recalculatedPaidOutAmount = 0n;
    for (const execution of executionRows) {
      if (execution.status === "orphaned") {
        continue;
      }
      recalculatedPaidOutAmount += BigInt(execution.amountToPayOut);
      const remainingAmount = totalPayoutAmount - recalculatedPaidOutAmount;
      const nextPaidOutAmount = recalculatedPaidOutAmount.toString();
      const nextRemainingAmount = remainingAmount.toString();
      if (
        execution.paidOutAmount !== nextPaidOutAmount ||
        execution.remainingAmount !== nextRemainingAmount
      ) {
        await executionRepository.update(
          {
            id: execution.id,
          },
          {
            paidOutAmount: nextPaidOutAmount,
            remainingAmount: nextRemainingAmount,
          },
        );
      }
    }

    if (proposal.paidOutAmount !== recalculatedPaidOutAmount.toString()) {
      await proposalRepository.update(
        { proposalPublicKey: payload.proposalPublicKey },
        { paidOutAmount: recalculatedPaidOutAmount.toString() },
      );
    }
    return true;
  }
}
