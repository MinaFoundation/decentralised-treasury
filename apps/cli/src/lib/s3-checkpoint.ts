import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

// Trace-digest checkpoints are a resumability aid, not the published voting
// ledger: they live under a distinct sub-prefix with a distinct suffix
// (`.sqlite.checkpoint`, never `.sqlite`) so they can never be mistaken for -
// or interfere with - the <lifecycleId>.sqlite / .sqlite.done contract that
// staking-ledgers-sync.sh and s3-sync-pull.sh already key on.
const CHECKPOINT_SUB_PREFIX = ".checkpoints";
const CHECKPOINT_SUFFIX = ".sqlite.checkpoint";

interface S3Location {
  bucket: string;
  key: string;
}

export function parseS3Uri(uri: string): S3Location {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(`Invalid S3 URI: ${uri} (expected s3://bucket/prefix)`);
  }
  const [, bucket, key] = match;
  return { bucket, key };
}

function checkpointLocation(prefixUri: string, lifecycleId: string): S3Location {
  const { bucket, key } = parseS3Uri(prefixUri);
  const trimmedKey = key.replace(/\/+$/, "");
  return {
    bucket,
    key: `${trimmedKey}/${CHECKPOINT_SUB_PREFIX}/${lifecycleId}${CHECKPOINT_SUFFIX}`,
  };
}

let cachedClient: S3Client | undefined;
function client(): S3Client {
  cachedClient ??= new S3Client({});
  return cachedClient;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}

// Downloads the checkpoint for lifecycleId to destinationPath. Returns false
// (destinationPath left untouched) if no checkpoint exists yet.
export async function pullCheckpoint(
  prefixUri: string,
  lifecycleId: string,
  destinationPath: string,
): Promise<boolean> {
  const { bucket, key } = checkpointLocation(prefixUri, lifecycleId);
  try {
    const response = await client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) {
      return false;
    }
    await pipeline(response.Body as Readable, createWriteStream(destinationPath));
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

// Uploads sourcePath as the checkpoint for lifecycleId, overwriting any prior
// checkpoint. Caller is responsible for the file being a complete, consistent
// snapshot (i.e. WAL-checkpointed) before calling this.
export async function pushCheckpoint(
  prefixUri: string,
  lifecycleId: string,
  sourcePath: string,
): Promise<void> {
  const { bucket, key } = checkpointLocation(prefixUri, lifecycleId);
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(sourcePath),
    }),
  );
}

// Removes the checkpoint for lifecycleId. Safe to call when none exists.
export async function cleanCheckpoint(
  prefixUri: string,
  lifecycleId: string,
): Promise<void> {
  const { bucket, key } = checkpointLocation(prefixUri, lifecycleId);
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}
