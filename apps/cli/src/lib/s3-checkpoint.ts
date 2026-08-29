import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

// A checkpoint upload observed hanging indefinitely in practice (no error, no
// completion - the process just sat there), which stalled every checkpoint
// for the rest of a run since scheduleCheckpoint() in the CLI command chains
// attempts onto one promise. requestTimeout bounds a single HTTP
// request/response; a hang isn't guaranteed to trip it (it depends on where
// the stall happens), so callers additionally race every send() against
// CHECKPOINT_UPLOAD_TIMEOUT_MS via AbortController as a hard backstop.
const CHECKPOINT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

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
  cachedClient ??= new S3Client({
    requestHandler: new NodeHttpHandler({
      requestTimeout: CHECKPOINT_UPLOAD_TIMEOUT_MS,
      connectionTimeout: 30_000,
    }),
  });
  return cachedClient;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}

// Hard backstop: aborts the command if it hasn't settled within timeoutMs,
// regardless of what the underlying HTTP client's own timeout does or doesn't
// catch. Without this, a hung request never rejects, so a promise chain that
// serializes attempts (as the trace-digest checkpoint scheduler does) can get
// stuck behind it forever.
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
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
    const response = await withTimeout(
      (signal) =>
        client().send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: signal,
        }),
      CHECKPOINT_UPLOAD_TIMEOUT_MS,
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
//
// Checkpoints for a mature lifecycle run into the gigabytes, and a plain
// PutObjectCommand streams that as one HTTP request: any transient error
// mid-stream (observed in practice as S3 InternalError / IncompleteBody)
// fails the entire multi-GB transfer with nothing to retry but starting over
// from byte zero. Uploading through lib-storage's Upload instead splits the
// file into parts and retries a failed part on its own, so a single blip
// doesn't cost the whole checkpoint.
export async function pushCheckpoint(
  prefixUri: string,
  lifecycleId: string,
  sourcePath: string,
): Promise<void> {
  const { bucket, key } = checkpointLocation(prefixUri, lifecycleId);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    CHECKPOINT_UPLOAD_TIMEOUT_MS,
  );
  try {
    const upload = new Upload({
      client: client(),
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(sourcePath),
      },
      abortController: controller,
    });
    await upload.done();
  } finally {
    clearTimeout(timer);
  }
}

// Removes the checkpoint for lifecycleId. Safe to call when none exists.
export async function cleanCheckpoint(
  prefixUri: string,
  lifecycleId: string,
): Promise<void> {
  const { bucket, key } = checkpointLocation(prefixUri, lifecycleId);
  try {
    await withTimeout(
      (signal) =>
        client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: signal,
        }),
      CHECKPOINT_UPLOAD_TIMEOUT_MS,
    );
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}
