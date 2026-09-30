/**
 * Normalize JSON strings to Latin-1 byte strings before stream-json sees them.
 * Raw export bytes remain unchanged. JSON escapes denote Unicode and use UTF-8.
 * Only an incomplete string is retained between chunks.
 */
export async function* ledgerJsonByteStrings(source: AsyncIterable<Buffer>) {
  let literal = "";
  let inString = false;
  let escaped = false;
  for await (const chunk of source) {
    const output: string[] = [];
    for (const char of chunk.toString("latin1")) {
      if (!inString) {
        if (char === '"') {
          inString = true;
          literal = char;
        } else {
          output.push(char);
        }
        continue;
      }
      literal += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        JSON.parse(literal); // Reject malformed escapes and unescaped control bytes.
        const bytes = literal
          .slice(1, -1)
          .replace(/(?:\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt]))+/g, (sequence) => {
            const decoded: string = JSON.parse(`"${sequence}"`);
            if (/[\uD800-\uDFFF]/u.test(decoded))
              throw new Error("Unpaired surrogate in ledger JSON escape");
            return Buffer.from(decoded, "utf8").toString("latin1");
          });
        output.push(JSON.stringify(bytes));
        literal = "";
        inString = false;
      }
    }
    yield output.join("");
  }
  if (inString) throw new Error("Unterminated string in ledger JSON");
}
