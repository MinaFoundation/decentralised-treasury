import type { BackofficeRuntimeConfig } from "./runtime-config";

export const PARTICIPANT_COUNT = 5;
export const REQUIRED_SIGNATURE_COUNT = 3;

export type OperationKind =
  | "pauseTreasury"
  | "unpauseTreasury"
  | "toggleProposal"
  | "rotateMultisig";

export interface OperationPackage {
  schemaVersion: 1;
  kind: OperationKind;
  networkId: string;
  treasuryOwnerAddress: string;
  pauseControllerAddress: string;
  controllerNonce: string;
  multisigCommitment: string;
  participants: string[];
  messageHash: string;
  proposalAddress?: string;
  proposalStatusBefore?: string;
  proposalStatusAfter?: string;
  expectedProposalPaused?: boolean;
  nextParticipants?: string[];
  nextMultisigCommitment?: string;
  signatures: Array<string | null>;
  createdAt: string;
}

export type SigningBundle = OperationPackage;

export interface TreasuryStatus {
  networkId: string;
  treasuryOwnerAddress: string;
  pauseControllerAddress: string;
  treasuryBalance: string;
  paused: boolean;
  controllerNonce: string;
  onChainCommitment: string;
  configuredCommitment?: string;
  participantCommitmentMatches: boolean;
  participants: string[];
  blockHeight?: number;
}

export interface ParticipantKeyReview {
  value: string;
  normalized?: string;
  valid: boolean;
  empty: boolean;
  duplicate: boolean;
  currentParticipantIndex?: number;
}

export interface ParticipantRotationReview {
  keys: ParticipantKeyReview[];
  emptyCount: number;
  invalidCount: number;
  duplicateCount: number;
  retainedCount: number;
  newCount: number;
  exactCurrentOrder: boolean;
  canBuild: boolean;
}

function resolveEndpointUrl(value: string): string {
  const origin =
    typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : undefined;
  if (!origin && !/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
    throw new Error(
      `Relative Mina node URL requires a browser origin: ${value}`,
    );
  }
  return new URL(value, origin).toString();
}

export function parseParticipantConfig(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function countSignatures(operation: OperationPackage): number {
  return operation.signatures.filter(Boolean).length;
}

export function createSigningOperation(
  operation: OperationPackage,
): OperationPackage {
  return {
    ...operation,
    signatures: Array.from({ length: PARTICIPANT_COUNT }, () => null),
  };
}

export function assertPureSigningOperation(
  operation: OperationPackage,
): OperationPackage {
  if (countSignatures(operation) !== 0) {
    throw new Error(
      "A signer operation must not contain participant signatures.",
    );
  }
  return operation;
}

const OPERATION_PAYLOAD_FIELDS: ReadonlyArray<
  Exclude<keyof OperationPackage, "signatures">
> = [
  "schemaVersion",
  "kind",
  "networkId",
  "treasuryOwnerAddress",
  "pauseControllerAddress",
  "controllerNonce",
  "multisigCommitment",
  "participants",
  "messageHash",
  "proposalAddress",
  "proposalStatusBefore",
  "proposalStatusAfter",
  "expectedProposalPaused",
  "nextParticipants",
  "nextMultisigCommitment",
  "createdAt",
];

export function mergeOperationSignatures(
  current: OperationPackage,
  incoming: OperationPackage,
): OperationPackage {
  for (const field of OPERATION_PAYLOAD_FIELDS) {
    if (JSON.stringify(current[field]) !== JSON.stringify(incoming[field])) {
      throw new Error(
        `The imported signature package has different operation data in ${field}.`,
      );
    }
  }

  const signatures = current.signatures.map((currentSignature, index) => {
    const incomingSignature = incoming.signatures[index];
    if (
      currentSignature &&
      incomingSignature &&
      currentSignature !== incomingSignature
    ) {
      throw new Error(
        `The imported package conflicts with participant ${index + 1}.`,
      );
    }
    return currentSignature ?? incomingSignature ?? null;
  });

  return { ...current, signatures };
}

export function assertOperationPackage(value: unknown): OperationPackage {
  if (!value || typeof value !== "object") {
    throw new Error("The operation file is not a JSON object.");
  }
  const candidate = value as Partial<OperationPackage>;
  const kinds: OperationKind[] = [
    "pauseTreasury",
    "unpauseTreasury",
    "toggleProposal",
    "rotateMultisig",
  ];
  if (
    candidate.schemaVersion !== 1 ||
    !candidate.kind ||
    !kinds.includes(candidate.kind)
  ) {
    throw new Error(
      "The operation file has an unsupported schema or operation type.",
    );
  }
  if (
    !candidate.networkId ||
    !candidate.treasuryOwnerAddress ||
    !candidate.pauseControllerAddress ||
    !candidate.controllerNonce ||
    !candidate.multisigCommitment ||
    !candidate.messageHash ||
    !Array.isArray(candidate.participants) ||
    candidate.participants.length !== PARTICIPANT_COUNT ||
    !Array.isArray(candidate.signatures) ||
    candidate.signatures.length !== PARTICIPANT_COUNT
  ) {
    throw new Error("The operation file is incomplete.");
  }
  return candidate as OperationPackage;
}

export async function validateParticipants(
  participants: string[],
): Promise<void> {
  if (participants.length !== PARTICIPANT_COUNT) {
    throw new Error(
      `Exactly ${PARTICIPANT_COUNT} participant public keys are required.`,
    );
  }
  const { PublicKey } = await import("o1js");
  const normalized = participants.map((value) =>
    PublicKey.fromBase58(value).toBase58(),
  );
  if (new Set(normalized).size !== PARTICIPANT_COUNT) {
    throw new Error("Participant public keys must be distinct.");
  }
}

export async function inspectParticipantRotation(
  currentParticipants: string[],
  nextParticipants: string[],
): Promise<ParticipantRotationReview> {
  const { PublicKey } = await import("o1js");
  const emptyPublicKey = PublicKey.empty().toBase58();
  const normalize = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed === emptyPublicKey) return emptyPublicKey;
    try {
      return PublicKey.fromBase58(trimmed).toBase58();
    } catch {
      return undefined;
    }
  };
  const normalizedCurrent = currentParticipants.map(normalize);
  const candidates = nextParticipants.map((value) => {
    const trimmed = value.trim();
    const normalized = normalize(trimmed);
    return {
      value: trimmed,
      normalized,
      valid: Boolean(normalized),
      empty: normalized === emptyPublicKey,
    };
  });
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.normalized) continue;
    counts.set(
      candidate.normalized,
      (counts.get(candidate.normalized) ?? 0) + 1,
    );
  }
  const keys = candidates.map((candidate) => {
    const currentParticipantIndex = candidate.normalized
      ? normalizedCurrent.indexOf(candidate.normalized)
      : -1;
    return {
      ...candidate,
      duplicate: candidate.normalized
        ? (counts.get(candidate.normalized) ?? 0) > 1
        : false,
      currentParticipantIndex:
        currentParticipantIndex >= 0 ? currentParticipantIndex : undefined,
    };
  });
  const emptyCount = keys.filter((key) => key.empty).length;
  const invalidCount = keys.filter(
    (key) => key.value.length > 0 && !key.valid,
  ).length;
  const duplicateCount = keys.filter((key) => key.duplicate).length;
  const retainedCount = keys.filter(
    (key) => key.currentParticipantIndex !== undefined,
  ).length;
  const newCount = keys.filter(
    (key) => key.valid && key.currentParticipantIndex === undefined,
  ).length;
  const exactCurrentOrder =
    keys.length === normalizedCurrent.length &&
    keys.every(
      (key, index) =>
        Boolean(key.normalized) && key.normalized === normalizedCurrent[index],
    );
  const allPresent =
    keys.length === PARTICIPANT_COUNT &&
    keys.every((key) => key.value.length > 0);

  return {
    keys,
    emptyCount,
    invalidCount,
    duplicateCount,
    retainedCount,
    newCount,
    exactCurrentOrder,
    canBuild:
      allPresent &&
      invalidCount === 0 &&
      emptyCount === 0 &&
      duplicateCount === 0 &&
      !exactCurrentOrder,
  };
}

export async function validateParticipantRotation(
  currentParticipants: string[],
  nextParticipants: string[],
): Promise<ParticipantRotationReview> {
  if (nextParticipants.length !== PARTICIPANT_COUNT) {
    throw new Error(
      `Exactly ${PARTICIPANT_COUNT} new participant public keys are required.`,
    );
  }
  const review = await inspectParticipantRotation(
    currentParticipants,
    nextParticipants,
  );
  if (review.keys.some((key) => key.value.length === 0)) {
    throw new Error("All new participant public keys are required.");
  }
  if (review.invalidCount > 0) {
    throw new Error("Each new participant must be a valid Mina public key.");
  }
  if (review.emptyCount > 0) {
    throw new Error(
      "PublicKey.empty is not permitted because it cannot provide a break-glass signature.",
    );
  }
  if (review.duplicateCount > 0) {
    throw new Error("New participant public keys must be distinct.");
  }
  if (review.exactCurrentOrder) {
    throw new Error(
      "The new participant keys are the current ordered key set.",
    );
  }
  return review;
}

export async function calculateCommitment(
  participants: string[],
): Promise<string> {
  await validateParticipants(participants);
  const [{ PublicKey }, { MultisigSignatures }] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js"),
  ]);
  return MultisigSignatures.createCommitment(
    participants.map((key) => PublicKey.fromBase58(key)),
  ).toString();
}

export async function fetchTreasuryStatus(
  config: BackofficeRuntimeConfig,
): Promise<TreasuryStatus> {
  if (!config.treasuryOwnerAddress) {
    throw new Error("NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS is required.");
  }
  const participants = parseParticipantConfig(config.multisigParticipants);
  await validateParticipants(participants);
  const [o1js, ownerModule, controllerModule] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-owner.js"),
    import("@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js"),
  ]);
  const { Mina, PublicKey, fetchAccount } = o1js;
  const networkId = config.networkId.toLowerCase() as
    | "mainnet"
    | "testnet"
    | "devnet";
  const nodeUrl = resolveEndpointUrl(config.minaNodeUrl);
  Mina.setActiveInstance(
    Mina.Network({
      mina: nodeUrl,
      networkId,
    }),
  );
  const ownerPublicKey = PublicKey.fromBase58(config.treasuryOwnerAddress);
  const ownerFetch = await fetchAccount({ publicKey: ownerPublicKey });
  if (ownerFetch.error) {
    throw new Error(
      `Treasury owner account was not found: ${String(ownerFetch.error)}`,
    );
  }
  const owner = new ownerModule.TreasuryOwnerSmartContract(ownerPublicKey);
  const controllerPublicKey = await owner.pauseControllerPublicKey.fetch();
  if (!controllerPublicKey) {
    throw new Error(
      "The treasury owner does not contain a pause controller address.",
    );
  }
  const controllerFetch = await fetchAccount({
    publicKey: controllerPublicKey,
  });
  if (controllerFetch.error) {
    throw new Error(
      `Pause controller account was not found: ${String(controllerFetch.error)}`,
    );
  }
  const controller = new controllerModule.TreasuryPauseControllerSmartContract(
    controllerPublicKey,
  );
  const [paused, onChainCommitment, configuredCommitment] = await Promise.all([
    controller.paused.fetch(),
    controller.multisigCommitment.fetch(),
    calculateCommitment(participants),
  ]);
  if (!paused || !onChainCommitment) {
    throw new Error("The pause controller state is incomplete.");
  }
  const account = Mina.getAccount(controllerPublicKey);
  let blockHeight: number | undefined;
  try {
    const response = await fetch(nodeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query:
          "query BackofficeHeight { bestChain(maxLength: 1) { protocolState { consensusState { blockHeight } } } }",
      }),
    });
    const payload = (await response.json()) as {
      data?: {
        bestChain?: Array<{
          protocolState?: { consensusState?: { blockHeight?: string } };
        }>;
      };
    };
    const parsed = Number(
      payload.data?.bestChain?.[0]?.protocolState?.consensusState?.blockHeight,
    );
    if (Number.isFinite(parsed)) blockHeight = parsed;
  } catch {
    // The contract state remains useful when the optional height query fails.
  }
  return {
    networkId: config.networkId,
    treasuryOwnerAddress: ownerPublicKey.toBase58(),
    pauseControllerAddress: controllerPublicKey.toBase58(),
    treasuryBalance: Mina.getBalance(ownerPublicKey).toString(),
    paused: paused.toBoolean(),
    controllerNonce: account.nonce.toString(),
    onChainCommitment: onChainCommitment.toString(),
    configuredCommitment,
    participantCommitmentMatches:
      onChainCommitment.toString() === configuredCommitment,
    participants,
    blockHeight,
  };
}

function statusName(value: string): string {
  return (
    (
      {
        "0": "UNKNOWN",
        "1": "APPROVED",
        "2": "REJECTED",
        "3": "PAUSED",
      } as Record<string, string>
    )[value] ?? value
  );
}

export async function fetchProposalStatus(
  config: BackofficeRuntimeConfig,
  treasuryOwnerAddress: string,
  proposalAddress: string,
): Promise<{ value: string; name: string }> {
  const [o1js, ownerModule, proposalModule] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-owner.js"),
    import("@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js"),
  ]);
  const { Mina, PublicKey, fetchAccount } = o1js;
  const networkId = config.networkId.toLowerCase() as
    | "mainnet"
    | "testnet"
    | "devnet";
  Mina.setActiveInstance(
    Mina.Network({
      mina: resolveEndpointUrl(config.minaNodeUrl),
      networkId,
    }),
  );
  const owner = new ownerModule.TreasuryOwnerSmartContract(
    PublicKey.fromBase58(treasuryOwnerAddress),
  );
  const proposalPublicKey = PublicKey.fromBase58(proposalAddress);
  const tokenId = owner.deriveTokenId();
  const result = await fetchAccount({ publicKey: proposalPublicKey, tokenId });
  if (result.error)
    throw new Error(`Proposal account was not found: ${String(result.error)}`);
  const proposal = new proposalModule.TreasuryProposalSmartContract(
    proposalPublicKey,
    tokenId,
  );
  const status = await proposal.status.fetch();
  if (!status) throw new Error("The proposal status is not available.");
  return { value: status.toString(), name: statusName(status.toString()) };
}

export async function createOperationPackage(input: {
  kind: OperationKind;
  status: TreasuryStatus;
  config: BackofficeRuntimeConfig;
  proposalAddress?: string;
  nextParticipants?: string[];
}): Promise<OperationPackage> {
  if (!input.status.participantCommitmentMatches) {
    throw new Error(
      "The configured participant list does not match the on-chain commitment.",
    );
  }
  const [o1js, multisigModule] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js"),
  ]);
  const nonce = o1js.UInt32.from(input.status.controllerNonce);
  let messageHash;
  let proposalStatusBefore: string | undefined;
  let proposalStatusAfter: string | undefined;
  let expectedProposalPaused: boolean | undefined;
  let nextMultisigCommitment: string | undefined;

  if (input.kind === "pauseTreasury") {
    messageHash = multisigModule.MultisigSignature.dataPauseTreasury(nonce);
  } else if (input.kind === "unpauseTreasury") {
    messageHash = multisigModule.MultisigSignature.dataUnpauseTreasury(nonce);
  } else if (input.kind === "toggleProposal") {
    if (!input.proposalAddress)
      throw new Error("A proposal address is required.");
    const current = await fetchProposalStatus(
      input.config,
      input.status.treasuryOwnerAddress,
      input.proposalAddress,
    );
    proposalStatusBefore = current.name;
    proposalStatusAfter = current.value === "3" ? "UNKNOWN" : "PAUSED";
    expectedProposalPaused = proposalStatusAfter === "PAUSED";
    messageHash = multisigModule.MultisigSignature.dataTogglePauseProposal(
      o1js.PublicKey.fromBase58(input.proposalAddress),
      nonce,
    );
  } else {
    if (!input.nextParticipants)
      throw new Error("Five new participant keys are required.");
    await validateParticipantRotation(
      input.status.participants,
      input.nextParticipants,
    );
    nextMultisigCommitment = await calculateCommitment(input.nextParticipants);
    if (nextMultisigCommitment === input.status.onChainCommitment) {
      throw new Error(
        "The new participant set has the current multisig commitment.",
      );
    }
    messageHash = multisigModule.MultisigSignature.dataRotateMultisigKeys(
      o1js.Field(input.status.onChainCommitment),
      o1js.Field(nextMultisigCommitment),
      nonce,
    );
  }

  return {
    schemaVersion: 1,
    kind: input.kind,
    networkId: input.config.networkId,
    treasuryOwnerAddress: input.status.treasuryOwnerAddress,
    pauseControllerAddress: input.status.pauseControllerAddress,
    controllerNonce: input.status.controllerNonce,
    multisigCommitment: input.status.onChainCommitment,
    participants: [...input.status.participants],
    messageHash: messageHash.toString(),
    proposalAddress: input.proposalAddress,
    proposalStatusBefore,
    proposalStatusAfter,
    expectedProposalPaused,
    nextParticipants: input.nextParticipants
      ? [...input.nextParticipants]
      : undefined,
    nextMultisigCommitment,
    signatures: Array.from({ length: PARTICIPANT_COUNT }, () => null),
    createdAt: new Date().toISOString(),
  };
}

export async function verifyOperationPackage(
  operation: OperationPackage,
  status: TreasuryStatus,
): Promise<void> {
  if (
    operation.networkId.toLowerCase() !== status.networkId.toLowerCase() ||
    operation.treasuryOwnerAddress !== status.treasuryOwnerAddress ||
    operation.pauseControllerAddress !== status.pauseControllerAddress ||
    operation.controllerNonce !== status.controllerNonce ||
    operation.multisigCommitment !== status.onChainCommitment ||
    operation.participants.join(",") !== status.participants.join(",")
  ) {
    throw new Error(
      "The signing bundle is stale or belongs to another deployment.",
    );
  }
  const [o1js, multisigModule] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js"),
  ]);
  const nonce = o1js.UInt32.from(operation.controllerNonce);
  let expectedMessage;
  if (operation.kind === "pauseTreasury") {
    expectedMessage = multisigModule.MultisigSignature.dataPauseTreasury(nonce);
  } else if (operation.kind === "unpauseTreasury") {
    expectedMessage =
      multisigModule.MultisigSignature.dataUnpauseTreasury(nonce);
  } else if (operation.kind === "toggleProposal") {
    if (!operation.proposalAddress)
      throw new Error("The proposal address is missing.");
    expectedMessage = multisigModule.MultisigSignature.dataTogglePauseProposal(
      o1js.PublicKey.fromBase58(operation.proposalAddress),
      nonce,
    );
  } else {
    if (!operation.nextParticipants || !operation.nextMultisigCommitment) {
      throw new Error("The new participant set is missing.");
    }
    await validateParticipantRotation(
      operation.participants,
      operation.nextParticipants,
    );
    const commitment = await calculateCommitment(operation.nextParticipants);
    if (commitment !== operation.nextMultisigCommitment) {
      throw new Error("The new participant commitment is invalid.");
    }
    expectedMessage = multisigModule.MultisigSignature.dataRotateMultisigKeys(
      o1js.Field(operation.multisigCommitment),
      o1js.Field(commitment),
      nonce,
    );
  }
  if (expectedMessage.toString() !== operation.messageHash) {
    throw new Error("The operation message hash is invalid.");
  }
}

export async function validateSignatures(
  operation: OperationPackage,
): Promise<boolean[]> {
  const { Field, PublicKey, Signature } = await import("o1js");
  const message = Field(operation.messageHash);
  return operation.signatures.map((signature, index) => {
    if (!signature) return false;
    try {
      return Signature.fromBase58(signature)
        .verify(PublicKey.fromBase58(operation.participants[index]!), [message])
        .toBoolean();
    } catch {
      return false;
    }
  });
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
