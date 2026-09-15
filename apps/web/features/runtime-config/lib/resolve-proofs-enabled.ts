/** Missing configuration keeps production proofs enabled. */
export function resolveProofsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  throw new Error("NEXT_PUBLIC_PROOFS_ENABLED must be true or false.");
}
