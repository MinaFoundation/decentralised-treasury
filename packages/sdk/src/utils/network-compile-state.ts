export function createNetworkCompileState() {
  let key: string | null = null;
  let promise: Promise<void> | null = null;

  return {
    async run(nextKey: string, compile: () => Promise<void>): Promise<void> {
      if (!promise || key !== nextKey) {
        const previous = promise;
        key = nextKey;
        promise = (async () => {
          await previous?.catch(() => undefined);
          await compile();
        })();
      }
      const current = promise;
      try {
        await current;
      } catch (error) {
        if (promise === current) {
          key = null;
          promise = null;
        }
        throw error;
      }
    },
  };
}
