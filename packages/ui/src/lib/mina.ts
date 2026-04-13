const NANO_MINA_PER_MINA = 1_000_000_000n;

function isPlainIntegerString(value: string): boolean {
  return /^-?\d+$/.test(value);
}

function formatGroupedInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function toFormattedMinaString(value: string | bigint): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const negative = amount < 0n;
  const absoluteAmount = negative ? -amount : amount;
  const whole = absoluteAmount / NANO_MINA_PER_MINA;
  const fractional = absoluteAmount % NANO_MINA_PER_MINA;
  const fractionalString = fractional.toString().padStart(9, "0").replace(/0+$/, "");
  const groupedWhole = formatGroupedInteger(whole.toString());

  return `${negative ? "-" : ""}${groupedWhole}${fractionalString ? `.${fractionalString}` : ""}`;
}

export function formatMinaAmount(value: string | bigint | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "bigint") {
    return toFormattedMinaString(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (isPlainIntegerString(trimmed)) {
    return toFormattedMinaString(trimmed);
  }

  return trimmed.replace(/\s*MINA$/i, "").trim();
}

export function formatMinaAmountWithSuffix(
  value: string | bigint | undefined | null,
): string | null {
  const formatted = formatMinaAmount(value);
  return formatted ? `${formatted} MINA` : null;
}

export function parseMinaAmount(value: string | undefined | null): number {
  const formatted = formatMinaAmount(value);
  if (!formatted) {
    return 0;
  }

  const parsed = Number(formatted.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
