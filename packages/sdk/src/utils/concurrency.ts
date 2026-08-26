// Runs `worker(item)` for each item pulled from `items`, keeping at most
// `limit` invocations in flight at once. Items are pulled lazily - the
// source is only asked for its next item once a slot is free - so an async
// generator that itself does I/O (a sqlite read per item, say) never runs
// further ahead than the concurrency limit allows.
//
// Existed because staking-ledger-to-voting-ledger-prover's digest() used to
// fire every batch in a lifecycle at the redis queue with no bound at all:
// for a devnet-sized ledger that is 18,000+ tasks in flight simultaneously,
// each holding a serialized trace payload and a pair of queue-event
// listeners alive in this process's heap until its own job completes. That
// grows linearly with ledger size rather than with available proving
// capacity, and reliably exhausted the default V8 heap long before the
// ledger did.
export async function forEachWithConcurrency<T>(
  items: AsyncIterable<T> | Iterable<T>,
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (limit < 1) {
    throw new Error(`concurrency limit must be at least 1, got ${limit}`);
  }

  const inFlight = new Set<Promise<void>>();
  // A worker's rejection is caught immediately and stashed here rather than
  // left to propagate through Promise.race/Promise.all: a worker that
  // settles between two `for await` iterations gets removed from inFlight
  // by its own .finally() before either of those ever awaits it, which
  // would otherwise turn its rejection into an orphaned unhandledRejection
  // instead of a rejection of this function.
  let firstError: unknown;
  let hasError = false;

  const run = (item: T): Promise<void> => {
    const running: Promise<void> = worker(item)
      .catch((error: unknown) => {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      })
      .finally(() => {
        inFlight.delete(running);
      });
    return running;
  };

  for await (const item of items) {
    if (hasError) break;

    if (inFlight.size >= limit) {
      await Promise.race(inFlight);
      if (hasError) break;
    }

    inFlight.add(run(item));
  }

  await Promise.all(inFlight);

  if (hasError) {
    throw firstError;
  }
}
