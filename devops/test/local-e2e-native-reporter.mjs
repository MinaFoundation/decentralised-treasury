// Keep native test identities as evidence beside LCOV and JUnit reports.
export default async function* nativeCaseReporter(events) {
  for await (const { type, data } of events) {
    if (!["test:pass", "test:fail"].includes(type)) continue;
    if (data.details?.type === "suite") continue;
    yield `${JSON.stringify({
      name: data.name,
      file: data.file,
      line: data.line,
      column: data.column,
      nesting: data.nesting,
      status: type === "test:pass" ? "passed" : "failed",
      skipped: Boolean(data.skip),
      todo: Boolean(data.todo),
    })}\n`;
  }
}
