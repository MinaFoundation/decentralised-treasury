import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Argument, Command, Option } from "commander";
import { createProgram } from "../src/cli.js";

const cliReferenceUrl = new URL(
  "../../docs/docs/operate/reference/cli-commands.md",
  import.meta.url,
);
const environmentReferenceUrl = new URL(
  "../../docs/docs/operate/reference/environment-fields.md",
  import.meta.url,
);

// Change this value only after the CLI reference is updated for the new
// command metadata. A mismatch prints the new value.
const expectedMetadataSha256 =
  "d92f334d1cbff4cbff184b86d8c5258407db2d50a3c00c46519aef5a7a76634c";

interface LeafCommand {
  command: Command;
  path: string;
}

function leafCommands(command: Command, prefix: string[] = []): LeafCommand[] {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    if (child.commands.length === 0) {
      return [{ command: child, path: path.join(" ") }];
    }
    return leafCommands(child, path);
  });
}

function normalizedDefault(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizedDefault);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function argumentMetadata(argument: Argument) {
  return {
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    default: normalizedDefault(argument.defaultValue),
    choices: argument.argChoices ?? null,
  };
}

function optionMetadata(option: Option) {
  return {
    long: option.long,
    short: option.short ?? null,
    valueRequired: option.required,
    valueOptional: option.optional,
    variadic: option.variadic,
    commandRequired: option.mandatory,
    environment: option.envVar ?? null,
    default: normalizedDefault(option.defaultValue),
    choices: option.argChoices ?? null,
  };
}

function currentMetadata(leaves: LeafCommand[]) {
  return leaves
    .map(({ command, path }) => ({
      path,
      arguments: command.registeredArguments.map(argumentMetadata),
      options: command.options
        .map(optionMetadata)
        .sort((left, right) => left.long.localeCompare(right.long)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function inlineCodeValues(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/`([^`\r\n]+)`/gu)].map((match) => match[1]),
  );
}

function documentedLongOptions(markdown: string): Set<string> {
  const options = new Set<string>();
  for (const value of inlineCodeValues(markdown)) {
    for (const match of value.matchAll(/--[a-z][a-z0-9-]*/gu)) {
      options.add(match[0]);
    }
  }
  return options;
}

test("the CLI reference covers the registered command surface", async () => {
  const leaves = leafCommands(createProgram());
  const cliReference = await readFile(cliReferenceUrl, "utf8");
  const environmentReference = await readFile(environmentReferenceUrl, "utf8");
  const cliCodeValues = inlineCodeValues(cliReference);
  const allCodeValues = inlineCodeValues(
    `${cliReference}\n${environmentReference}`,
  );
  const longOptions = documentedLongOptions(cliReference);

  const missingCommands = leaves
    .map(({ path }) => path)
    .filter((path) => !cliCodeValues.has(path));
  assert.deepEqual(
    missingCommands,
    [],
    `CLI reference lacks leaf commands: ${missingCommands.join(", ")}`,
  );

  const missingOptions = [
    ...new Set(
      leaves.flatMap(({ command }) =>
        command.options.map((option) => option.long),
      ),
    ),
  ].filter((option) => !longOptions.has(option));
  assert.deepEqual(
    missingOptions,
    [],
    `CLI reference lacks long options: ${missingOptions.join(", ")}`,
  );

  const missingEnvironmentAliases = [
    ...new Set(
      leaves.flatMap(({ command }) =>
        command.options.flatMap((option) =>
          option.envVar === undefined ? [] : [option.envVar],
        ),
      ),
    ),
  ].filter((name) => !allCodeValues.has(name));
  assert.deepEqual(
    missingEnvironmentAliases,
    [],
    `CLI and environment references lack aliases: ${missingEnvironmentAliases.join(", ")}`,
  );

  const missingArguments = leaves.flatMap(({ command, path }) =>
    command.registeredArguments
      .map((argument) => `<${argument.name()}>`)
      .filter((argument) => !cliCodeValues.has(argument))
      .map((argument) => `${path} ${argument}`),
  );
  assert.deepEqual(
    missingArguments,
    [],
    `CLI reference lacks positional arguments: ${missingArguments.join(", ")}`,
  );
});

test("the documented CLI metadata snapshot matches Commander", () => {
  const digest = sha256(currentMetadata(leafCommands(createProgram())));
  assert.equal(
    digest,
    expectedMetadataSha256,
    [
      "Commander metadata changed.",
      "Update the CLI reference for command, option, environment, positional argument, required, default, or choice changes.",
      `Then set expectedMetadataSha256 to ${digest}.`,
    ].join(" "),
  );
});
