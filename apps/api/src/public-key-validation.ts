export const PUBLIC_KEY_VALIDATION_ERROR =
  "publicKey must be a valid Mina public key";

interface PublicKeyModule {
  PublicKey: {
    fromBase58(value: string): {
      toBase58(): string;
    };
  };
}

let publicKeyModulePromise: Promise<PublicKeyModule> | null = null;

async function getPublicKeyModule(): Promise<PublicKeyModule> {
  if (publicKeyModulePromise) {
    return await publicKeyModulePromise;
  }

  publicKeyModulePromise = (async () => {
    const moduleName = "o1js";
    const o1jsModule = await import(moduleName);
    return o1jsModule as PublicKeyModule;
  })();
  return await publicKeyModulePromise;
}

export async function normalizePublicKey(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(PUBLIC_KEY_VALIDATION_ERROR);
  }

  const normalized = value.trim();
  try {
    const { PublicKey } = await getPublicKeyModule();
    return PublicKey.fromBase58(normalized).toBase58();
  } catch {
    throw new Error(PUBLIC_KEY_VALIDATION_ERROR);
  }
}
