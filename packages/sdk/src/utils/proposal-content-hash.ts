export const MARKDOWN_ZKAPP_URI_PREFIX = "urn:proposal-content:markdown:sha256:";
export const MAX_ZKAPP_URI_UTF8_BYTES = 255;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function getWebCryptoSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Web Crypto API is not available in this runtime. Expected crypto.subtle.",
    );
  }
  return subtle;
}

export function assertZkappUriWithinByteLimit(zkappUri: string): void {
  const uriBytes = new TextEncoder().encode(zkappUri).length;
  if (uriBytes > MAX_ZKAPP_URI_UTF8_BYTES) {
    throw new Error(
      `Proposal zkapp URI exceeds Mina limit: ${uriBytes} bytes (max ${MAX_ZKAPP_URI_UTF8_BYTES} bytes).`,
    );
  }
}

export async function hashMarkdownContentToZkappUri(
  markdownContent: Uint8Array,
): Promise<string> {
  // Copy into a plain ArrayBuffer to satisfy strict BufferSource typing
  // across Node and browser TS lib combinations.
  const digestInput = new Uint8Array(markdownContent.byteLength);
  digestInput.set(markdownContent);
  const digest = await getWebCryptoSubtle().digest(
    "SHA-256",
    digestInput.buffer,
  );
  const digestHex = bytesToHex(new Uint8Array(digest));
  return `${MARKDOWN_ZKAPP_URI_PREFIX}${digestHex}`;
}
