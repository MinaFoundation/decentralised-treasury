export const MINIMUM_LOADING_DURATION_MS = 300;

export async function withMinimumLoadingDuration<T>(
  operation: Promise<T>,
  durationMs = MINIMUM_LOADING_DURATION_MS,
): Promise<T> {
  const minimumDuration = new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

  try {
    return await operation;
  } finally {
    await minimumDuration;
  }
}
