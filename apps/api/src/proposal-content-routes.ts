import type { EventsApiServerOptions } from "@repo/indexer";
import {
  assertZkappUriWithinByteLimit,
  hashMarkdownContentToZkappUri,
} from "@repo/sdk/src/utils/proposal-content-hash.js";
import { profanity } from "@2toad/profanity";
import type { DataSource } from "typeorm";

export const DEFAULT_PROPOSAL_CONTENT_MAX_CHARS = 32 * 1024;
export const PROPOSAL_CONTENT_REQUIRED_ERROR =
  "contents must be a non-empty markdown string";
export const PROPOSAL_CONTENT_TOO_LARGE_ERROR = "contents exceeds maximum allowed length";
export const PROPOSAL_CONTENT_EXPLICIT_LANGUAGE_ERROR =
  "contents contains prohibited explicit language";
export const PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR =
  "proposal for submitted contents was not found";

interface ProposalContentHashResult {
  zkAppUri: string;
  zkAppUriHash: string;
}

interface ProposalContentRow {
  proposal_public_key: string;
}

interface ProposalContentRoutesOptions {
  dataSource: DataSource;
  maxProposalContentsChars?: number;
  containsExplicitLanguage?: (markdown: string) => boolean;
  hashMarkdownToProposalZkAppUriHash?: (
    markdown: string,
  ) => Promise<ProposalContentHashResult>;
}

interface ProposalContentsValidationSuccess {
  contents: string;
  contentChars: number;
}

interface ProposalContentsValidationFailure {
  error: string;
  maxProposalContentsChars?: number;
  contentChars?: number;
}

function isMissingProcessorProposalsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeCode = "code" in error ? (error as { code?: unknown }).code : null;
  if (maybeCode === "42P01") {
    return true;
  }
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return (
    message.includes("processor_proposals") &&
    (message.includes("does not exist") || message.includes("relation"))
  );
}

function validateProposalContents(
  contents: unknown,
  maxProposalContentsChars: number,
  containsExplicitLanguage: (markdown: string) => boolean,
): ProposalContentsValidationSuccess | ProposalContentsValidationFailure {
  if (typeof contents !== "string" || contents.length === 0) {
    return {
      error: PROPOSAL_CONTENT_REQUIRED_ERROR,
    };
  }

  const contentChars = Array.from(contents).length;
  if (contentChars > maxProposalContentsChars) {
    return {
      error: PROPOSAL_CONTENT_TOO_LARGE_ERROR,
      maxProposalContentsChars,
      contentChars,
    };
  }

  if (containsExplicitLanguage(contents)) {
    return {
      error: PROPOSAL_CONTENT_EXPLICIT_LANGUAGE_ERROR,
    };
  }

  return {
    contents,
    contentChars,
  };
}

async function defaultHashMarkdownToProposalZkAppUriHash(
  markdown: string,
): Promise<ProposalContentHashResult> {
  const markdownBytes = new TextEncoder().encode(markdown);
  const zkAppUri = await hashMarkdownContentToZkappUri(markdownBytes);
  assertZkappUriWithinByteLimit(zkAppUri);

  const o1jsModuleName = "o1js";
  const o1jsModule = await import(o1jsModuleName);
  const ZkappUri = (
    o1jsModule as {
      ZkappUri: {
        from(value: string): { hash: { toString(): string } };
      };
    }
  ).ZkappUri;
  const zkAppUriHash = ZkappUri.from(zkAppUri).hash.toString();
  return { zkAppUri, zkAppUriHash };
}

export function createProposalContentRoutes({
  dataSource,
  maxProposalContentsChars = DEFAULT_PROPOSAL_CONTENT_MAX_CHARS,
  containsExplicitLanguage = (markdown: string) => profanity.exists(markdown),
  hashMarkdownToProposalZkAppUriHash = defaultHashMarkdownToProposalZkAppUriHash,
}: ProposalContentRoutesOptions): NonNullable<EventsApiServerOptions["registerRoutes"]> {
  return (app) => {
    app.post("/proposals/content/verify", async (request, response) => {
      const contents = (request.body as { contents?: unknown } | null | undefined)
        ?.contents;
      const validation = validateProposalContents(
        contents,
        maxProposalContentsChars,
        containsExplicitLanguage,
      );
      if ("error" in validation) {
        response.status(400).json(validation);
        return;
      }

      response.json({
        ok: true,
        passesSubmissionChecks: true,
        containsExplicitLanguage: false,
        contentChars: validation.contentChars,
        maxProposalContentsChars,
      });
    });

    app.post("/proposals/:id/content", async (request, response) => {
      const proposalPublicKey = request.params?.id;
      if (typeof proposalPublicKey !== "string" || proposalPublicKey.trim().length === 0) {
        response.status(400).json({
          error: "proposal id must be a non-empty proposal public key",
        });
        return;
      }
      const contents = (request.body as { contents?: unknown } | null | undefined)
        ?.contents;
      const validation = validateProposalContents(
        contents,
        maxProposalContentsChars,
        containsExplicitLanguage,
      );
      if ("error" in validation) {
        response.status(400).json(validation);
        return;
      }
      const { contents: validatedContents, contentChars } = validation;

      let hashResult: ProposalContentHashResult;
      try {
        hashResult = await hashMarkdownToProposalZkAppUriHash(validatedContents);
      } catch (error) {
        console.error("[indexer-api] failed to hash proposal markdown contents", error);
        response.status(500).json({
          error: "Internal server error",
        });
        return;
      }

      try {
        const proposals = (await dataSource.query(
          `SELECT "proposal_public_key"
           FROM "processor_proposals"
           WHERE "proposal_public_key" = $1
             AND "zkapp_uri_hash" = $2
           LIMIT 1`,
          [proposalPublicKey, hashResult.zkAppUriHash],
        )) as ProposalContentRow[];

        if (!proposals.length) {
          response.status(404).json({
            error: PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR,
            proposalPublicKey,
            zkAppUri: hashResult.zkAppUri,
            zkAppUriHash: hashResult.zkAppUriHash,
          });
          return;
        }

        await dataSource.query(
          `UPDATE "processor_proposals"
           SET "contents" = $1,
               "updated_at" = NOW()
           WHERE "proposal_public_key" = $2
             AND "zkapp_uri_hash" = $3`,
          [validatedContents, proposalPublicKey, hashResult.zkAppUriHash],
        );

        response.json({
          ok: true,
          contentChars,
          proposalPublicKey,
          zkAppUri: hashResult.zkAppUri,
          zkAppUriHash: hashResult.zkAppUriHash,
        });
      } catch (error) {
        if (isMissingProcessorProposalsTable(error)) {
          response.status(503).json({
            error: "proposal content API is unavailable",
          });
          return;
        }
        console.error("[indexer-api] failed to upsert proposal contents", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });
  };
}
