import { test as base, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Raw Chromium coverage is evidence only. This is not source-mapped LCOV. */
export const test = base.extend<{ browserEvidence: void }>({
  browserEvidence: [
    async ({ page, browserName }, use, testInfo) => {
      const messages: Array<{ type: string; text: string }> = [];
      page.on("console", (message) =>
        messages.push({ type: message.type(), text: message.text() }),
      );
      page.on("pageerror", (error) =>
        messages.push({ type: "pageerror", text: error.message }),
      );
      const session =
        browserName === "chromium"
          ? await page.context().newCDPSession(page)
          : undefined;
      const sources = new Map<
        string,
        Promise<{ sourcePath?: string; error?: string }>
      >();
      const sourceDirectory = testInfo.outputPath("chromium-v8-sources");
      await mkdir(sourceDirectory, { recursive: true });
      let sourceIndex = 0;
      if (session) {
        session.on("Debugger.scriptParsed", (script) => {
          if (!script.url || script.url === "__playwright_evaluation_script__")
            return;
          const sourcePath = join(
            sourceDirectory,
            `source-${String(sourceIndex++).padStart(5, "0")}.js`,
          );
          sources.set(
            script.scriptId,
            session
              .send("Debugger.getScriptSource", { scriptId: script.scriptId })
              .then(async ({ scriptSource }) => {
                // Keep navigation coverage without retaining every large o1js
                // source string in the Playwright worker's heap.
                await writeFile(sourcePath, scriptSource);
                return { sourcePath };
              })
              .catch((error) => ({ error: String(error) })),
          );
        });
        await session.send("Profiler.enable");
        await session.send("Debugger.enable");
        await session.send("Profiler.startPreciseCoverage", {
          callCount: true,
          detailed: true,
        });
      }
      await use();
      if (!page.isClosed() && session) {
        // Playwright's stopJSCoverage aggregates all sources into one protocol
        // response. Large o1js bundles exceed V8's string limit. CDP returns the
        // ranges separately; source requests above each contain one script.
        const { result: entries } = await session.send(
          "Profiler.takePreciseCoverage",
        );
        await session.send("Profiler.stopPreciseCoverage");
        const directory = testInfo.outputPath("chromium-v8-coverage");
        await mkdir(directory, { recursive: true });
        const files: string[] = [];
        const missingSources: Array<{
          scriptId: string;
          url: string;
          error?: string;
        }> = [];
        for (const [index, entry] of entries.entries()) {
          if (!entry.url || entry.url === "__playwright_evaluation_script__")
            continue;
          const loaded = await sources.get(entry.scriptId);
          if (loaded?.sourcePath === undefined) {
            missingSources.push({
              scriptId: entry.scriptId,
              url: entry.url,
              error: loaded?.error,
            });
            continue;
          }
          const filename = `script-${String(index).padStart(5, "0")}.json`;
          await writeFile(
            join(directory, filename),
            JSON.stringify([
              { ...entry, source: await readFile(loaded.sourcePath, "utf8") },
            ]),
          );
          files.push(filename);
        }
        const path = testInfo.outputPath("chromium-v8-coverage-manifest.json");
        await writeFile(
          path,
          JSON.stringify({
            format: "playwright-v8-per-script",
            directory,
            files,
            missingSources,
          }),
        );
        await testInfo.attach("chromium-v8-coverage", {
          path,
          contentType: "application/json",
        });
        await session.detach();
        expect(
          missingSources,
          "Every captured script must retain its source.",
        ).toEqual([]);
      }
      await testInfo.attach("browser-console", {
        body: JSON.stringify(messages, null, 2),
        contentType: "application/json",
      });
    },
    { auto: true },
  ],
});

export { expect };
