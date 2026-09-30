import { findDefaultTokenAccountIndex } from "@repo/sdk/src/utils/default-token-account.js";
import { KeyvSqlite } from "@keyv/sqlite";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LedgerHashBase58, type PublicKey } from "o1js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { configureMinaNetwork, type TreasuryNetwork } from "./mina-instance.js";

interface DownloadTallyInputsOptions {
  backendUrl: string;
  minaNodeUrl: string;
  network: TreasuryNetwork;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  outputDirectory: string;
}

async function download(url: URL, path: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_600_000) });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error(
      `Artifact download failed: HTTP ${response.status} for ${url.pathname}. Check backend publication.`,
    );
  }
  // Stream lifecycle databases; they can be several gigabytes.
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path, { flags: "wx" }),
  );
}

/** Download inputs only. This command does not compile, prove, sign, or submit. */
export async function downloadTallyInputs(options: DownloadTallyInputsOptions) {
  const backend = new URL(options.backendUrl);
  if (
    !["https:", "http:"].includes(backend.protocol) ||
    backend.username ||
    backend.password
  ) {
    throw new Error(
      "Use an HTTP or HTTPS backend URL without embedded credentials.",
    );
  }
  backend.pathname = `${backend.pathname.replace(/\/+$/, "")}/`;
  backend.search = "";
  backend.hash = "";
  configureMinaNetwork(options.minaNodeUrl, options.network);
  const proposal = await new SqliteTreasuryOwnerService().getProposalState(
    options,
  );
  const lifecycleId = proposal.lifecycleId;
  if (!/^\d+$/.test(lifecycleId))
    throw new Error("Invalid Proposal lifecycle ID.");

  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  // Refuse an existing directory so a download cannot replace local proving work.
  await mkdir(outputDirectory);
  try {
    for (const name of [
      `${lifecycleId}.sqlite.done`,
      `${lifecycleId}.sqlite.proven`,
    ]) {
      await download(
        new URL(`sqlite/${name}`, backend),
        join(outputDirectory, name),
      );
      const marker = JSON.parse(
        await readFile(join(outputDirectory, name), "utf8"),
      );
      if (marker.lifecycleId !== lifecycleId)
        throw new Error(`Lifecycle mismatch in ${name}.`);
    }
    const done = JSON.parse(
      await readFile(
        join(outputDirectory, `${lifecycleId}.sqlite.done`),
        "utf8",
      ),
    );
    if (
      LedgerHashBase58.fromBase58(done.ledgerHash).toString() !==
      proposal.stakingEpochDataLedgerHash
    ) {
      throw new Error(
        "The backend staking snapshot does not match the Proposal.",
      );
    }

    const stakingProofPath = join(
      outputDirectory,
      `${lifecycleId}-exhausted.json`,
    );
    await download(
      new URL(`proofs/${lifecycleId}-exhausted.json`, backend),
      stakingProofPath,
    );
    const stakingProof =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
        JSON.parse(await readFile(stakingProofPath, "utf8")),
      );
    if (
      !stakingProof.publicOutput.exhausted.toBoolean() ||
      stakingProof.publicInput.stakingLedgerRoot.toString() !==
        proposal.stakingEpochDataLedgerHash
    ) {
      throw new Error(
        "The staking proof must be exhausted and match the Proposal snapshot.",
      );
    }

    const sqlitePath = join(outputDirectory, `${lifecycleId}.sqlite`);
    await download(
      new URL(`sqlite/${lifecycleId}.sqlite`, backend),
      sqlitePath,
    );
    const sqlite = new KeyvSqlite({ uri: sqlitePath });
    try {
      const rows = (await sqlite.query("PRAGMA quick_check")) as Array<{
        quick_check: string;
      }>;
      if (rows.length !== 1 || rows[0].quick_check !== "ok") {
        throw new Error(
          "The downloaded SQLite database failed its integrity check.",
        );
      }
    } finally {
      await sqlite.disconnect();
    }
    const ledger = new SqliteStakingLedgerService({
      lifecycleId,
      dbPath: sqlitePath,
    });
    try {
      await ledger.start();
      if (
        (await ledger.getRootHash()).toString() !==
        proposal.stakingEpochDataLedgerHash
      ) {
        throw new Error(
          "The downloaded database does not match the Proposal snapshot.",
        );
      }
      const accounts = await ledger.getAllAccounts();
      const owner =
        accounts[
          findDefaultTokenAccountIndex(accounts, options.treasuryOwnerPublicKey)
        ];
      if (!owner || owner.balance.toBigInt() === 0n) {
        throw new Error(
          "The snapshot must contain a default-token Treasury Owner account with a nonzero balance.",
        );
      }
    } finally {
      await ledger.close();
    }

    const settings = {
      MINA_NODE_URL: options.minaNodeUrl,
      NETWORK: options.network,
      TREASURY_OWNER_PUBLIC_KEY: options.treasuryOwnerPublicKey.toBase58(),
      PROPOSAL_PUBLIC_KEY: options.proposalPublicKey.toBase58(),
      LIFECYCLE_ID: lifecycleId,
      SQLITE_DATA_DIRECTORY: outputDirectory,
      STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH: stakingProofPath,
      VOTE_REDUCER_PROOF_PATH: join(outputDirectory, "vote-reducer-merge.json"),
      VOTE_ACTIONS_PATH: join(outputDirectory, "vote-actions.json"),
      PROOFS_ENABLED: "true",
    };
    const settingsPath = join(outputDirectory, ".env");
    // Single quotes keep dotenvx from expanding variables or running substitutions.
    const quote = (value: string) => {
      if (/[\r\n']/.test(value)) {
        throw new Error(
          "Dotenv settings cannot contain single quotes or line breaks. Use a different path or Mina URL.",
        );
      }
      return `'${value}'`;
    };
    await writeFile(
      settingsPath,
      Object.entries(settings)
        .map(([name, value]) => `${name}=${quote(value)}\n`)
        .join(""),
      { flag: "wx" },
    );
    const result = { lifecycleId, settingsPath, sqlitePath, stakingProofPath };
    console.log(JSON.stringify(result));
    console.error(
      "Inputs downloaded. Use dotenvx with the generated .env, then prepare the Proposal vote proof before tallying.",
    );
    return result;
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}
