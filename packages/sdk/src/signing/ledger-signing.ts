import { Client as MinaSignerClient, type NetworkId } from "mina-signer";
import {
  Field,
  Group,
  Mina,
  Poseidon,
  PublicKey,
  Signature,
  Transaction,
  type Types,
} from "o1js";

type ZkappCommandJson = Types.Json.ZkappCommand;

interface LedgerAddressResponse {
  returnCode: string;
  publicKey?: string | null;
  message?: string;
  statusText?: string;
}

interface LedgerFieldSignatureResponse {
  returnCode: string;
  field: string | null;
  scalar: string | null;
  message?: string;
  statusText?: string;
}

/** @internal */
export interface LedgerSigningClient {
  getAddress(
    account: number,
    showOnDevice?: boolean,
  ): Promise<LedgerAddressResponse>;
  signFieldElement(
    account: number,
    networkId: number,
    fieldElement: Uint8Array,
  ): Promise<LedgerFieldSignatureResponse>;
}

interface LedgerAccount {
  accountIndex: number;
  publicKey: PublicKey;
}

export type LedgerAccountIndices = ReadonlyMap<string, number>;

function responseError(
  operation: string,
  response: { returnCode: string; message?: string; statusText?: string },
): Error {
  const detail =
    response.message ?? response.statusText ?? `status ${response.returnCode}`;
  return new Error(`Ledger ${operation} failed: ${detail}`);
}

function activeNetworkId(): NetworkId {
  const networkId = Mina.getNetworkId();
  if (
    networkId !== "mainnet" &&
    networkId !== "testnet" &&
    networkId !== "devnet"
  ) {
    throw new Error(
      `Ledger field signing does not support Mina network ID ${networkId}`,
    );
  }
  return networkId;
}

function ledgerNetworkId(networkId: NetworkId): number {
  return networkId === "mainnet" ? 1 : 0;
}

function verifyFieldSignature(
  signature: Signature,
  publicKey: PublicKey,
  field: Field,
  networkId: NetworkId,
): boolean {
  const point = publicKey.toGroup();
  const prefix =
    networkId === "mainnet" ? "MinaSignatureMainnet" : "CodaSignature*******";
  const challenge = Poseidon.hashWithPrefix(prefix, [
    field,
    point.x,
    point.y,
    signature.r,
  ]);
  const reconstructed = point
    .scale(challenge)
    .neg()
    .add(Group.generator.scale(signature.s));
  return reconstructed.x
    .equals(signature.r)
    .and(reconstructed.y.isEven())
    .toBoolean();
}

function validateAccountIndex(accountIndex: number): void {
  if (
    !Number.isSafeInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 0xffff_ffff
  ) {
    throw new Error(
      `Ledger account index must be an integer from 0 through 4294967295, got ${String(accountIndex)}`,
    );
  }
}

async function resolveLedgerAccounts(
  ledger: LedgerSigningClient,
  expectedPublicKeys: ReadonlySet<string>,
  accountIndices: LedgerAccountIndices,
): Promise<Map<string, LedgerAccount>> {
  const found = new Map<string, LedgerAccount>();

  for (const expectedPublicKey of expectedPublicKeys) {
    const accountIndex = accountIndices.get(expectedPublicKey);
    if (accountIndex === undefined) {
      throw new Error(
        `Ledger account index is required for ${expectedPublicKey}`,
      );
    }
    validateAccountIndex(accountIndex);
    const response = await ledger.getAddress(accountIndex, true);
    if (response.returnCode !== "9000" || !response.publicKey) {
      throw responseError("address request", response);
    }
    if (response.publicKey !== expectedPublicKey) {
      throw new Error(
        `Ledger account index ${accountIndex} returned ${response.publicKey}, expected ${expectedPublicKey}`,
      );
    }
    found.set(expectedPublicKey, {
      accountIndex,
      publicKey: PublicKey.fromBase58(expectedPublicKey),
    });
  }

  return found;
}

async function signFieldAtAccount(
  ledger: LedgerSigningClient,
  account: LedgerAccount,
  field: Field,
  networkId: number,
): Promise<Signature> {
  const response = await ledger.signFieldElement(
    account.accountIndex,
    networkId,
    new Uint8Array(Field.toBytes(field)),
  );
  if (
    response.returnCode !== "9000" ||
    response.field === null ||
    response.scalar === null
  ) {
    throw responseError("field signing", response);
  }

  return Signature.fromJSON({
    r: response.field,
    s: response.scalar,
  });
}

function requiredTransactionPublicKeys(command: ZkappCommandJson): Set<string> {
  const publicKeys = new Set<string>([command.feePayer.body.publicKey]);
  for (const update of command.accountUpdates) {
    if (update.body.authorizationKind.isSigned) {
      publicKeys.add(update.body.publicKey);
    }
  }
  return publicKeys;
}

/**
 * Internal transport-neutral implementation used by the CLI and browser
 * wrappers. The caller supplies one verified Ledger index for each signer.
 *
 * @internal
 */
export async function signTransactionWithLedgerClient(
  transaction: { toJSON(): string },
  ledger: LedgerSigningClient,
  accountIndices: LedgerAccountIndices,
  requestedNetworkId?: NetworkId,
): Promise<ReturnType<typeof Transaction.fromJSON>> {
  const command = JSON.parse(transaction.toJSON()) as ZkappCommandJson;
  const networkId = requestedNetworkId ?? activeNetworkId();
  const minaSigner = new MinaSignerClient({ network: networkId, era: "mesa" });
  const commitments = minaSigner.getZkappCommandCommitmentsFromJSON(command);
  const requiredPublicKeys = requiredTransactionPublicKeys(command);
  const ledgerPublicKeys = new Set(accountIndices.keys());
  const feePayerPublicKey = command.feePayer.body.publicKey;
  if (!ledgerPublicKeys.has(feePayerPublicKey)) {
    throw new Error(
      `Ledger account index is required for fee payer ${feePayerPublicKey}`,
    );
  }
  for (const publicKey of ledgerPublicKeys) {
    if (!requiredPublicKeys.has(publicKey)) {
      throw new Error(
        `Ledger signer ${publicKey} does not own a required transaction signature`,
      );
    }
  }
  const accounts = await resolveLedgerAccounts(
    ledger,
    ledgerPublicKeys,
    accountIndices,
  );
  const signatureCache = new Map<string, string>();

  const signFor = async (
    publicKey: string,
    commitment: bigint,
  ): Promise<string> => {
    const account = accounts.get(publicKey);
    if (!account) {
      throw new Error(`Ledger account index resolution failed for ${publicKey}`);
    }
    const cacheKey = `${account.accountIndex}:${commitment.toString()}`;
    const cached = signatureCache.get(cacheKey);
    if (cached) return cached;

    const field = Field(commitment);
    const signature = await signFieldAtAccount(
      ledger,
      account,
      field,
      ledgerNetworkId(networkId),
    );
    if (!verifyFieldSignature(signature, account.publicKey, field, networkId)) {
      throw new Error(`Ledger returned an invalid signature for ${publicKey}`);
    }
    const encoded = signature.toBase58();
    signatureCache.set(cacheKey, encoded);
    return encoded;
  };

  command.feePayer.authorization = await signFor(
    command.feePayer.body.publicKey,
    commitments.fullCommitment,
  );

  for (const update of command.accountUpdates) {
    if (
      !update.body.authorizationKind.isSigned ||
      !ledgerPublicKeys.has(update.body.publicKey)
    ) {
      continue;
    }
    const commitment = update.body.useFullCommitment
      ? commitments.fullCommitment
      : commitments.commitment;
    update.authorization.signature = await signFor(
      update.body.publicKey,
      commitment,
    );
  }

  return Transaction.fromJSON(command);
}

/**
 * Internal transport-neutral implementation used by the CLI and browser
 * wrappers. Break-glass field signatures use one explicit Ledger index.
 *
 * @internal
 */
export async function signFieldWithLedgerClient(
  field: Field,
  ledger: LedgerSigningClient,
  expectedPublicKey: PublicKey,
  accountIndex: number,
): Promise<Signature> {
  const publicKey = expectedPublicKey.toBase58();
  const accounts = await resolveLedgerAccounts(
    ledger,
    new Set([publicKey]),
    new Map([[publicKey, accountIndex]]),
  );
  const account = accounts.get(publicKey);
  if (!account) {
    throw new Error(`Ledger account index resolution failed for ${publicKey}`);
  }

  const signature = await signFieldAtAccount(ledger, account, field, 0);
  if (!signature.verify(expectedPublicKey, [field]).toBoolean()) {
    throw new Error(
      `Ledger returned an invalid field signature for ${publicKey}`,
    );
  }
  return signature;
}
