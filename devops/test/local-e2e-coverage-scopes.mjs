import assert from "node:assert/strict";

export function assertCoveredSourceScopes(lcov, scopes) {
  const records = lcov.split("end_of_record").map((record) => ({
    file: record.match(/^SF:(.+)$/m)?.[1],
    coveredLines: [
      ...record.matchAll(/^DA:(\d+),(\d+)(?:,[^\r\n]*)?$/gm),
    ].filter((match) => Number(match[1]) > 0 && Number(match[2]) > 0).length,
  }));
  return scopes.map((scope) => {
    assert.match(scope, /^(?:apps|packages)\/[a-z0-9-]+\/src\/$/);
    const files = records.filter(
      ({ file, coveredLines }) =>
        file?.startsWith(scope) &&
        !file.split("/").includes("..") &&
        /\.[cm]?tsx?$/.test(file) &&
        coveredLines > 0,
    );
    assert.ok(files.length > 0, `No executed TypeScript coverage for ${scope}`);
    return { scope, files };
  });
}
