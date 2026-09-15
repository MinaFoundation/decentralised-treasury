/** Match the Mina Ledger app's 32-byte, big-endian hexadecimal display. */
export function formatLedgerSigningHash(decimalField: string): string {
  // https://github.com/Zondax/ledger-mina/blob/f2c341190f81deb53c21523255a637e42c6d45ed/src/utils.c#L279
  return BigInt(decimalField).toString(16).padStart(64, "0");
}
