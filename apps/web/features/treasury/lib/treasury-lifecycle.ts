import type {
  TreasuryLifecyclePeriodId,
  TreasuryLifecyclePeriodMetadata,
} from "@repo/ui/treasury-lifecycle-period-info";
import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

const CURRENT_GLOBAL_SLOT_QUERY = `
  query CurrentTreasuryLifecycleState {
    bestChain(maxLength: 1) {
      protocolState {
        consensusState {
          slotSinceGenesis
        }
      }
    }
  }
`;

const NUMBER_OF_LIFECYCLE_PERIODS = 4;
const LIFECYCLE_PERIOD_IDS: TreasuryLifecyclePeriodId[] = [
  "proposal",
  "exploration",
  "voting",
  "cooldown",
];

export interface TreasuryLifecycleSnapshot {
  currentGlobalSlot: number;
  treasuryDeployedAtSlot: number;
  currentLifecycleId: number;
  currentPeriod: TreasuryLifecyclePeriodId;
  currentPeriodProgress: number;
  lifecycleStarted: boolean;
}

interface CurrentGlobalSlotResponse {
  data?: {
    bestChain?: Array<{
      protocolState?: {
        consensusState?: {
          slotSinceGenesis?: string | number | null;
        } | null;
      } | null;
    }>;
  };
  errors?: Array<{ message?: string }>;
}

async function fetchTreasuryDeployedAtSlot(
  minaNodeUrl: string,
  treasuryOwnerAddress: string,
): Promise<number> {
  const { Mina, PublicKey } = await import("o1js");
  const { TreasuryOwnerSmartContract } = await import(
    "@repo/sdk/src/provable/contracts/treasury-owner.js"
  );
  const resolvedMinaNodeUrl = resolveEndpointUrl(minaNodeUrl);

  Mina.setActiveInstance(
    Mina.Network({
      mina: resolvedMinaNodeUrl,
    }),
  );

  const treasuryOwner = new TreasuryOwnerSmartContract(
    PublicKey.fromBase58(treasuryOwnerAddress),
  );
  const treasuryDeployedAtSlot = await treasuryOwner.treasuryDeployedAtSlot.fetch();
  if (!treasuryDeployedAtSlot) {
    throw new Error(
      `Treasury owner did not return treasuryDeployedAtSlot for ${treasuryOwnerAddress}.`,
    );
  }

  return Number(treasuryDeployedAtSlot.toString());
}

export async function fetchTreasuryPausedState(
  minaNodeUrl: string,
  treasuryOwnerAddress: string,
): Promise<boolean> {
  const { Mina, PublicKey } = await import("o1js");
  const [{ TreasuryOwnerSmartContract }, { TreasuryPauseControllerSmartContract }] =
    await Promise.all([
      import("@repo/sdk/src/provable/contracts/treasury-owner.js"),
      import(
        "@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js"
      ),
    ]);
  const resolvedMinaNodeUrl = resolveEndpointUrl(minaNodeUrl);

  Mina.setActiveInstance(
    Mina.Network({
      mina: resolvedMinaNodeUrl,
    }),
  );

  const treasuryOwner = new TreasuryOwnerSmartContract(
    PublicKey.fromBase58(treasuryOwnerAddress),
  );
  const pauseControllerPublicKey = await treasuryOwner.pauseControllerPublicKey.fetch();
  if (!pauseControllerPublicKey) {
    throw new Error(
      `Treasury owner did not return pauseControllerPublicKey for ${treasuryOwnerAddress}.`,
    );
  }

  const pauseController = new TreasuryPauseControllerSmartContract(
    pauseControllerPublicKey,
  );
  const paused = await pauseController.paused.fetch();
  if (!paused) {
    throw new Error(
      `Pause controller did not return paused state for ${pauseControllerPublicKey.toBase58()}.`,
    );
  }

  return paused.toBoolean();
}

async function fetchCurrentTreasuryLifecycleState(
  minaNodeUrl: string,
  treasuryOwnerAddress: string,
): Promise<{ currentGlobalSlot: number; treasuryDeployedAtSlot: number }> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: CURRENT_GLOBAL_SLOT_QUERY,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch treasury lifecycle state: ${response.status}`);
  }

  const payload = (await response.json()) as CurrentGlobalSlotResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown error").join("; "));
  }

  const currentGlobalSlot = Number(
    payload.data?.bestChain?.[0]?.protocolState?.consensusState?.slotSinceGenesis ?? Number.NaN,
  );
  if (!Number.isFinite(currentGlobalSlot)) {
    throw new Error("Mina node response did not include slotSinceGenesis.");
  }

  const treasuryDeployedAtSlot = await fetchTreasuryDeployedAtSlot(
    minaNodeUrl,
    treasuryOwnerAddress,
  );

  return {
    currentGlobalSlot,
    treasuryDeployedAtSlot,
  };
}

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function resolveCurrentPeriodId(elapsedPeriods: number): TreasuryLifecyclePeriodId {
  return LIFECYCLE_PERIOD_IDS[elapsedPeriods % NUMBER_OF_LIFECYCLE_PERIODS] ?? "proposal";
}

export function deriveCurrentTreasuryLifecycleSnapshot(
  currentGlobalSlot: number,
  treasuryDeployedAtSlot: number,
  lifecyclePeriodDuration: number,
): TreasuryLifecycleSnapshot {
  if (!Number.isFinite(lifecyclePeriodDuration) || lifecyclePeriodDuration <= 0) {
    throw new Error("NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION must be a positive number.");
  }

  if (currentGlobalSlot < treasuryDeployedAtSlot) {
    return {
      currentGlobalSlot,
      treasuryDeployedAtSlot,
      currentLifecycleId: 0,
      currentPeriod: "proposal",
      currentPeriodProgress: 0,
      lifecycleStarted: false,
    };
  }

  const elapsedSlots = currentGlobalSlot - treasuryDeployedAtSlot;
  const elapsedPeriods = Math.floor(elapsedSlots / lifecyclePeriodDuration);
  const currentLifecycleId = Math.floor(elapsedPeriods / NUMBER_OF_LIFECYCLE_PERIODS);
  const currentPeriod = resolveCurrentPeriodId(elapsedPeriods);
  const periodSlotOffset = elapsedSlots % lifecyclePeriodDuration;
  const periodWidth = Math.max(1, lifecyclePeriodDuration - 1);
  const currentPeriodProgress = clampPercentage((periodSlotOffset / periodWidth) * 100);

  return {
    currentGlobalSlot,
    treasuryDeployedAtSlot,
    currentLifecycleId,
    currentPeriod,
    currentPeriodProgress,
    lifecycleStarted: true,
  };
}

export async function fetchCurrentTreasuryLifecycleSnapshot(
  minaNodeUrl: string,
  treasuryOwnerAddress: string,
  lifecyclePeriodDuration: number,
): Promise<TreasuryLifecycleSnapshot> {
  const { currentGlobalSlot, treasuryDeployedAtSlot } = await fetchCurrentTreasuryLifecycleState(
    minaNodeUrl,
    treasuryOwnerAddress,
  );

  const snapshot = deriveCurrentTreasuryLifecycleSnapshot(
    currentGlobalSlot,
    treasuryDeployedAtSlot,
    lifecyclePeriodDuration,
  );
  console.log("[treasury-lifecycle] derived snapshot", {
    currentGlobalSlot,
    treasuryDeployedAtSlot,
    lifecyclePeriodDuration,
    snapshot,
  });
  return snapshot;
}

export async function fetchCurrentTreasuryLifecycleId(
  minaNodeUrl: string,
  treasuryOwnerAddress: string,
  lifecyclePeriodDuration: number,
): Promise<number | undefined> {
  const snapshot = await fetchCurrentTreasuryLifecycleSnapshot(
    minaNodeUrl,
    treasuryOwnerAddress,
    lifecyclePeriodDuration,
  );
  return snapshot.lifecycleStarted ? snapshot.currentLifecycleId : undefined;
}

function estimateSlotDate(
  slot: number,
  currentGlobalSlot: number,
  slotDurationMs: number,
  nowMs: number,
): string {
  return new Date(nowMs + (slot - currentGlobalSlot) * slotDurationMs).toISOString();
}

export function buildTreasuryLifecyclePeriodMetadata(input: {
  lifecycleId: number;
  currentGlobalSlot: number;
  treasuryDeployedAtSlot: number;
  lifecyclePeriodDuration: number;
  slotDurationMs?: number;
  nowMs?: number;
}): TreasuryLifecyclePeriodMetadata[] {
  const {
    lifecycleId,
    currentGlobalSlot,
    treasuryDeployedAtSlot,
    lifecyclePeriodDuration,
    slotDurationMs,
    nowMs = Date.now(),
  } = input;
  const lifecycleStartSlot =
    treasuryDeployedAtSlot + lifecycleId * NUMBER_OF_LIFECYCLE_PERIODS * lifecyclePeriodDuration;
  const shouldEstimateDates =
    typeof slotDurationMs === "number" && Number.isFinite(slotDurationMs) && slotDurationMs > 0;

  return LIFECYCLE_PERIOD_IDS.map((period, index) => {
    const startSlot = lifecycleStartSlot + index * lifecyclePeriodDuration;
    const endSlot = startSlot + lifecyclePeriodDuration - 1;

    return {
      period,
      slotRange: `${startSlot} - ${endSlot}`,
      estimatedStart: shouldEstimateDates
        ? estimateSlotDate(startSlot, currentGlobalSlot, slotDurationMs, nowMs)
        : undefined,
      estimatedEnd: shouldEstimateDates
        ? estimateSlotDate(endSlot + 1, currentGlobalSlot, slotDurationMs, nowMs)
        : undefined,
    };
  });
}

export function buildTreasuryLifecycleOptions(
  currentLifecycleId: number,
  maxCount = 6,
): number[] {
  const normalizedMaxCount = Math.max(1, Math.floor(maxCount));
  const earliestLifecycleId = Math.max(0, currentLifecycleId - normalizedMaxCount + 1);

  return Array.from(
    { length: currentLifecycleId - earliestLifecycleId + 1 },
    (_, index) => currentLifecycleId - index,
  );
}
