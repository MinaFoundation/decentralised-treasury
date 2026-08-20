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

const LEDGER_ACCOUNT_SCAN_LIMIT = 100;

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

async function findLedgerAccounts(
  ledger: LedgerSigningClient,
  expectedPublicKeys: ReadonlySet<string>,
): Promise<Map<string, LedgerAccount>> {
  const found = new Map<string, LedgerAccount>();

  for (
    let accountIndex = 0;
    accountIndex < LEDGER_ACCOUNT_SCAN_LIMIT &&
    found.size < expectedPublicKeys.size;
    accountIndex += 1
  ) {
    const response = await ledger.getAddress(accountIndex, false);
    if (response.returnCode !== "9000" || !response.publicKey) {
      throw responseError("address request", response);
    }
    if (!expectedPublicKeys.has(response.publicKey)) {
      continue;
    }
    found.set(response.publicKey, {
      accountIndex,
      publicKey: PublicKey.fromBase58(response.publicKey),
    });
  }

  const missing = [...expectedPublicKeys].filter(
    (publicKey) => !found.has(publicKey),
  );
  if (missing.length > 0) {
    throw new Error(
      `Ledger does not contain the required public key${missing.length === 1 ? "" : "s"} within its first ${LEDGER_ACCOUNT_SCAN_LIMIT} Mina accounts: ${missing.join(", ")}`,
    );
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
 * wrappers. Application transaction code consumes only signTxWithLedger(tx).
 *
 * @internal
 */
export async function signTransactionWithLedgerClient(
  transaction: { toJSON(): string },
  ledger: LedgerSigningClient,
): Promise<ReturnType<typeof Transaction.fromJSON>> {
  const command = JSON.parse(transaction.toJSON()) as ZkappCommandJson;
  const networkId = activeNetworkId();
  const minaSigner = new MinaSignerClient({ network: networkId, era: "mesa" });
  const commitments = minaSigner.getZkappCommandCommitmentsFromJSON(command);
  const accounts = await findLedgerAccounts(
    ledger,
    requiredTransactionPublicKeys(command),
  );
  const signatureCache = new Map<string, string>();

  const signFor = async (
    publicKey: string,
    commitment: bigint,
  ): Promise<string> => {
    const account = accounts.get(publicKey);
    if (!account) {
      throw new Error(`Ledger account discovery failed for ${publicKey}`);
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
    if (!update.body.authorizationKind.isSigned) continue;
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
 * wrappers. Break-glass field signatures use the o1js message domain.
 *
 * @internal
 */
export async function signFieldWithLedgerClient(
  field: Field,
  ledger: LedgerSigningClient,
  expectedPublicKey: PublicKey,
): Promise<Signature> {
  const publicKey = expectedPublicKey.toBase58();
  const accounts = await findLedgerAccounts(ledger, new Set([publicKey]));
  const account = accounts.get(publicKey);
  if (!account) {
    throw new Error(`Ledger account discovery failed for ${publicKey}`);
  }

  const signature = await signFieldAtAccount(ledger, account, field, 0);
  if (!signature.verify(expectedPublicKey, [field]).toBoolean()) {
    throw new Error(
      `Ledger returned an invalid field signature for ${publicKey}`,
    );
  }
  return signature;
}
