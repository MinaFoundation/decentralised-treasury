#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAIN_AUDIENCES,
  PAGE_KINDS,
  addError,
  docsRoot,
  isPlainObject,
  listFiles,
  parseYaml,
  printErrors,
  relativeToDocs,
  relativeToRepository,
  repositoryRoot,
} from "./lib.mjs";

const BLOCKED_PLACEHOLDERS = [
  /\bCHANGE[_-]?ME\b/i,
  /\bREPLACE[_-]?ME\b/i,
  /\bINSERT[_-]?(?:SECRET|PASSWORD|PRIVATE[_-]?KEY|TOKEN)[_-]?HERE\b/i,
  /<(?:your[-_ ])?(?:secret|password|private[-_ ]key|access[-_ ]token)>/i,
];

const SECRET_PATTERNS = [
  ["a private-key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["a GitHub token", /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/],
  ["a GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["a Mina private key", /\bEK[1-9A-HJ-NP-Za-km-z]{50}\b/],
  ["a Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  [
    "a JWT value",
    /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ],
];

const FORBIDDEN_MAIN_PROSE = [
  ["handoff language", /\bhandoff\b/i],
  ["team ownership language", /\b(?:incoming|outgoing|the) team\b/i],
  ["owner-role language", /\bowner roles?\b/i],
  ["environment manifest language", /\b(?:approved |environment )?manifest\b/i],
  [
    "backup policy language",
    /\bbackup (?:policy|retention|owner|rehearsal)\b/i,
  ],
  ["restore rehearsal language", /\brestore rehearsal\b/i],
  ["capacity-plan language", /\bcapacity plan\b/i],
  ["liability-register language", /\bliabilit(?:y|ies) register\b/i],
  ["TEST_EXPECTATION", /\bTEST_EXPECTATION\b/],
  ["claim ID", /\bCLAIM-[A-Z0-9-]+\b/],
  ["static-analysis path", /\.codebase-analysis\//],
  ["analysis source path", /apps\/docs\/evidence\//],
  ["evidence terminology", /\bevidence\b/i],
  ["Contract truth heading", /\bContract truth\b/i],
  ["Evidence boundary heading", /\bEvidence boundary\b/i],
  ["review-source assertion", /reviewed source directly supports/i],
  ["approved-proposal payment wording", /pay(?:ing)? an approved proposal/i],
  ["unsupported Mina term", /Accepted Mina ledger state/i],
];

const FORBIDDEN_PUBLISHED_CONTENT = [
  [
    "a concrete environment-family runtime filename",
    /\.env\.(?:testnet|local-blockchain)\b/,
  ],
];

function splitFrontMatter(text, source, errors) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    addError(errors, source, "The page must start with YAML front matter.");
    return { frontMatterText: null, body: text, bodyLineOffset: 0 };
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    addError(errors, source, "The YAML front matter has no closing delimiter.");
    return { frontMatterText: null, body: text, bodyLineOffset: 0 };
  }
  return {
    frontMatterText: match[1],
    body: text.slice(match[0].length),
    bodyLineOffset: (match[0].match(/\n/g) ?? []).length,
  };
}

function maskCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (block) => " ".repeat(block.length));
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function headingSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function headingsAndAnchors(body) {
  const masked = maskCode(body);
  const headings = [];
  const anchors = new Set();
  const slugCounts = new Map();
  for (const match of masked.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const raw = match[1].trim();
    const explicit = raw.match(/\s*\{#([A-Za-z][\w-]*)\}\s*$/);
    const title = explicit ? raw.slice(0, explicit.index).trim() : raw;
    headings.push({ level: match[0].match(/^#+/)[0].length, title });
    if (explicit) anchors.add(explicit[1]);
    const baseSlug = headingSlug(title);
    if (!baseSlug) continue;
    const count = slugCounts.get(baseSlug) ?? 0;
    anchors.add(count === 0 ? baseSlug : `${baseSlug}-${count}`);
    slugCounts.set(baseSlug, count + 1);
  }
  return { headings, anchors };
}

function markdownLinks(body) {
  const masked = maskCode(body);
  const links = [];
  const inlinePattern =
    /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+['"][^)]*['"])?\s*\)/g;
  const referencePattern = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;
  for (const pattern of [inlinePattern, referencePattern]) {
    for (const match of masked.matchAll(pattern)) {
      links.push({
        target: match[1].replace(/^<|>$/g, ""),
        index: match.index,
      });
    }
  }
  return links;
}

async function existingFile(candidates) {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function validateLocalLink(errors, page, body, link, pageDataByPath) {
  const source = relativeToRepository(page);
  const pageData = pageDataByPath.get(path.resolve(page));
  const line = lineNumberAt(body, link.index) + pageData.bodyLineOffset;
  if (link.target === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link.target)) {
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(link.target);
  } catch {
    addError(
      errors,
      `${source}:${line}`,
      `The link has invalid URL encoding: ${link.target}.`,
    );
    return;
  }
  const hashIndex = decoded.indexOf("#");
  const fragment = hashIndex >= 0 ? decoded.slice(hashIndex + 1) : "";
  const beforeHash = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded;
  const pathname = beforeHash.split("?")[0];

  let targetFile = page;
  if (pathname.startsWith("/")) {
    const targetData = pageDataByPath.routes.get(normalizeRoute(pathname));
    if (!targetData) {
      addError(
        errors,
        `${source}:${line}`,
        `The documentation route does not exist: ${link.target}.`,
      );
      return;
    }
    if (fragment && !targetData.anchors.has(fragment)) {
      addError(
        errors,
        `${source}:${line}`,
        `The target has no anchor #${fragment}: ${link.target}.`,
      );
    }
    return;
  }
  if (pathname) {
    const baseTarget = path.resolve(path.dirname(page), pathname);
    targetFile = await existingFile([
      baseTarget,
      `${baseTarget}.md`,
      `${baseTarget}.mdx`,
      path.join(baseTarget, "index.md"),
      path.join(baseTarget, "index.mdx"),
    ]);
    if (!targetFile) {
      addError(
        errors,
        `${source}:${line}`,
        `The local link target does not exist: ${link.target}.`,
      );
      return;
    }
  }

  if (!fragment) return;
  const targetData = pageDataByPath.get(path.resolve(targetFile));
  if (!targetData || !targetData.anchors.has(fragment)) {
    addError(
      errors,
      `${source}:${line}`,
      `The target has no anchor #${fragment}: ${link.target}.`,
    );
  }
}

function normalizeRoute(route) {
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  return collapsed === "/" ? collapsed : collapsed.replace(/\/$/, "");
}

function routeForPage(page, frontMatter) {
  if (typeof frontMatter.slug === "string" && frontMatter.slug.trim()) {
    if (frontMatter.slug.startsWith("/"))
      return normalizeRoute(frontMatter.slug);
    const parent = path.posix.dirname(relativeToDocs(page));
    return normalizeRoute(path.posix.join(parent, frontMatter.slug));
  }
  const relative = relativeToDocs(page).replace(/\.mdx?$/, "");
  if (path.posix.basename(relative) === "index") {
    return normalizeRoute(path.posix.dirname(relative));
  }
  return normalizeRoute(relative);
}

function validateSecrets(errors, source, body) {
  for (const [description, pattern] of SECRET_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      addError(
        errors,
        `${source}:${lineNumberAt(body, match.index)}`,
        `The public page contains ${description}.`,
      );
    }
  }
  for (const pattern of BLOCKED_PLACEHOLDERS) {
    const match = body.match(pattern);
    if (match) {
      addError(
        errors,
        `${source}:${lineNumberAt(body, match.index)}`,
        `Use an explicit variable placeholder instead of ${match[0]}.`,
      );
    }
  }
}

function validateMainProse(errors, source, body) {
  const prose = maskCode(body);
  for (const [description, pattern] of FORBIDDEN_MAIN_PROSE) {
    const match = prose.match(pattern);
    if (match) {
      addError(
        errors,
        `${source}:${lineNumberAt(prose, match.index)}`,
        `The page contains ${description}: ${match[0]}.`,
      );
    }
  }
}

function validatePublishedContent(errors, source, body) {
  for (const [description, pattern] of FORBIDDEN_PUBLISHED_CONTENT) {
    const match = body.match(pattern);
    if (match) {
      addError(
        errors,
        `${source}:${lineNumberAt(body, match.index)}`,
        `The page contains ${description}: ${match[0]}. Use the documented role placeholder.`,
      );
    }
  }
}

async function validateSources(
  errors,
  source,
  body,
  bodyLineOffset,
  headings,
  pageKind,
) {
  if (pageKind === "navigation") return;
  const levelTwo = headings.filter((heading) => heading.level === 2);
  if (levelTwo.at(-1)?.title !== "Sources") {
    addError(errors, source, "The final level-two section must be Sources.");
    return;
  }

  const sourceHeadingMatches = [...body.matchAll(/^## Sources\s*$/gm)];
  const sourceHeading = sourceHeadingMatches.at(-1);
  if (!sourceHeading) return;
  const section = body.slice(sourceHeading.index + sourceHeading[0].length);
  const bullets = [...section.matchAll(/^\s*-\s+(.+)$/gm)];
  if (bullets.length === 0) {
    addError(
      errors,
      source,
      "The Sources section must contain at least one path.",
    );
    return;
  }

  const canonicalRoot = await realpath(repositoryRoot);
  const rootWithSeparator = `${canonicalRoot}${path.sep}`;
  for (const bullet of bullets) {
    const line =
      lineNumberAt(
        body,
        sourceHeading.index + sourceHeading[0].length + bullet.index,
      ) + bodyLineOffset;
    const pathMatch = bullet[1].match(/^`([^`]+)`(?:\s|$)/);
    if (!pathMatch) {
      addError(
        errors,
        `${source}:${line}`,
        "A source entry must start with one repository path in code formatting.",
      );
      continue;
    }
    const sourcePath = pathMatch[1];
    if (
      path.isAbsolute(sourcePath) ||
      sourcePath.split(/[\\/]/).includes("..") ||
      sourcePath.trim() !== sourcePath
    ) {
      addError(
        errors,
        `${source}:${line}`,
        `The source path is not repository-relative: ${sourcePath}.`,
      );
      continue;
    }
    const resolved = path.resolve(repositoryRoot, sourcePath);
    try {
      await stat(resolved);
      const canonicalPath = await realpath(resolved);
      if (
        canonicalPath !== canonicalRoot &&
        !canonicalPath.startsWith(rootWithSeparator)
      ) {
        addError(
          errors,
          `${source}:${line}`,
          `The source path resolves outside the repository: ${sourcePath}.`,
        );
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        addError(
          errors,
          `${source}:${line}`,
          `The source path does not exist: ${sourcePath}.`,
        );
      } else {
        throw error;
      }
    }
  }
}

export async function loadAndValidateDocs() {
  const errors = [];
  const pages = await listFiles(docsRoot, [".md", ".mdx"]);
  const pageDataByPath = new Map();
  pageDataByPath.routes = new Map();

  for (const page of pages) {
    const source = relativeToRepository(page);
    const text = await readFile(page, "utf8");
    const { frontMatterText, body, bodyLineOffset } = splitFrontMatter(
      text,
      source,
      errors,
    );
    let frontMatter = {};
    if (frontMatterText !== null) {
      try {
        frontMatter = await parseYaml(frontMatterText, source);
      } catch (error) {
        addError(errors, source, error.message.replace(`${source}: `, ""));
      }
    }
    if (!isPlainObject(frontMatter)) frontMatter = {};
    const { headings, anchors } = headingsAndAnchors(body);
    const data = {
      source,
      text,
      body,
      bodyLineOffset,
      frontMatter,
      headings,
      anchors,
    };
    pageDataByPath.set(path.resolve(page), data);
    const route = routeForPage(page, frontMatter);
    if (pageDataByPath.routes.has(route)) {
      addError(
        errors,
        source,
        `The documentation route duplicates ${pageDataByPath.routes.get(route).source}: ${route}.`,
      );
    } else {
      pageDataByPath.routes.set(route, data);
    }
  }

  for (const page of pages) {
    const data = pageDataByPath.get(path.resolve(page));
    const { source, text, body, bodyLineOffset, frontMatter, headings } = data;
    const normalizedPath = relativeToDocs(page);
    const isMain =
      normalizedPath.startsWith("learn/") ||
      normalizedPath.startsWith("operate/");
    const isPublishedMain = normalizedPath === "index.md" || isMain;
    const isReview = normalizedPath.startsWith("review/");

    if (typeof frontMatter.title !== "string" || !frontMatter.title.trim()) {
      addError(errors, source, "The front matter must contain a title.");
    }
    if (
      typeof frontMatter.sidebar_label !== "string" ||
      !frontMatter.sidebar_label.trim()
    ) {
      addError(
        errors,
        source,
        "The front matter must contain a sidebar_label.",
      );
    }
    if (isMain) {
      if (!MAIN_AUDIENCES.includes(frontMatter.audience)) {
        addError(
          errors,
          source,
          `audience must be one of: ${MAIN_AUDIENCES.join(", ")}.`,
        );
      }
      if (!PAGE_KINDS.includes(frontMatter.page_kind)) {
        addError(
          errors,
          source,
          `page_kind must be one of: ${PAGE_KINDS.join(", ")}.`,
        );
      }
    } else if (isReview && frontMatter.page_kind !== "reference") {
      addError(errors, source, "Review pages must use page_kind: reference.");
    }

    if (isPublishedMain) {
      validatePublishedContent(errors, source, text);
      validateMainProse(errors, source, text);
      await validateSources(
        errors,
        source,
        body,
        bodyLineOffset,
        headings,
        frontMatter.page_kind,
      );
    }

    validateSecrets(errors, source, text);
    for (const link of markdownLinks(body)) {
      await validateLocalLink(errors, page, body, link, pageDataByPath);
    }
  }

  return { errors, pages, pageDataByPath };
}

async function main() {
  const result = await loadAndValidateDocs();
  printErrors(result.errors);
  if (result.errors.length > 0) process.exitCode = 1;
  else
    process.stdout.write(
      `Validated ${result.pages.length} Markdown page(s).\n`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
