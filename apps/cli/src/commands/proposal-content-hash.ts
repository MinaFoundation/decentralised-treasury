import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  assertZkappUriWithinByteLimit,
  hashMarkdownContentToZkappUri,
  MARKDOWN_ZKAPP_URI_PREFIX,
  MAX_ZKAPP_URI_UTF8_BYTES,
} from "@repo/sdk/src/utils/proposal-content-hash.js";

export { MARKDOWN_ZKAPP_URI_PREFIX, MAX_ZKAPP_URI_UTF8_BYTES };
export { hashMarkdownContentToZkappUri };

const MARKDOWN_FILE_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const NUL_BYTE = 0x00;

export interface ResolveProposalZkappUriOptions {
  contentFile: string;
}

export async function readProposalMarkdownContent({
  contentFile,
}: ResolveProposalZkappUriOptions): Promise<string> {
  const extension = extname(contentFile).toLowerCase();
  if (!MARKDOWN_FILE_EXTENSIONS.has(extension)) {
    throw new Error(
      `Proposal content file must be markdown (.md/.markdown/.mdown/.mkd). Received: ${contentFile}`,
    );
  }

  const markdownContent = await readFile(contentFile);
  if (markdownContent.length === 0) {
    throw new Error(`Proposal content file is empty: ${contentFile}`);
  }
  // Guard against binary-ish payloads. This checks for byte value 0x00,
  // not the textual character "0" (which is byte 0x30 in UTF-8/ASCII).
  if (markdownContent.includes(NUL_BYTE)) {
    throw new Error(
      `Proposal content file appears to contain binary data (NUL byte found): ${contentFile}`,
    );
  }

  return markdownContent.toString("utf8");
}

export async function resolveProposalZkappUri({
  contentFile,
}: ResolveProposalZkappUriOptions): Promise<string> {
  const markdownContent = await readProposalMarkdownContent({
    contentFile,
  });

  const hashedProposalZkappUri = await hashMarkdownContentToZkappUri(
    new TextEncoder().encode(markdownContent),
  );
  assertZkappUriWithinByteLimit(hashedProposalZkappUri);
  return hashedProposalZkappUri;
}
