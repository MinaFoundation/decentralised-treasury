export type LedgerName = "staking" | "voting" | "nullifier";

export interface ExpectedLedgerCall {
  readonly ledger: LedgerName;
  readonly method: string;
  readonly key?: string;
}

export interface LoggedLedgerCall extends ExpectedLedgerCall {
  readonly sequence: number;
}

function describeCall(call: ExpectedLedgerCall): string {
  const key = call.key === undefined ? "" : `(${call.key})`;
  return `${call.ledger}.${call.method}${key}`;
}

export class StrictCallLog {
  readonly #expected: readonly ExpectedLedgerCall[];
  readonly #calls: LoggedLedgerCall[] = [];
  #cursor = 0;

  public constructor(expected: readonly ExpectedLedgerCall[]) {
    this.#expected = expected.map((call) => ({ ...call }));
  }

  public record(call: ExpectedLedgerCall): void {
    const expected = this.#expected[this.#cursor];
    const matches =
      expected !== undefined &&
      expected.ledger === call.ledger &&
      expected.method === call.method &&
      expected.key === call.key;

    if (!matches) {
      const expectedDescription =
        expected === undefined ? "end of script" : describeCall(expected);
      throw new Error(
        `Unexpected ledger call ${this.#cursor + 1}: expected ${expectedDescription}; received ${describeCall(call)}.`,
      );
    }

    this.#calls.push({ sequence: this.#cursor + 1, ...call });
    this.#cursor += 1;
  }

  public assertComplete(): void {
    const missing = this.#expected[this.#cursor];
    if (missing !== undefined) {
      throw new Error(
        `Missing ledger call ${this.#cursor + 1}: expected ${describeCall(missing)}.`,
      );
    }
  }

  public snapshot(): readonly LoggedLedgerCall[] {
    return this.#calls.map((call) => ({ ...call }));
  }
}
