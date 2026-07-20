import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

const NANO_MINA_PER_MINA = 1_000_000_000n;

function formatFractionalMina(fractional: bigint): string {
  if (fractional === 0n) {
    return "";
  }

  return fractional.toString().padStart(9, "0").replace(/0+$/, "");
}

export function formatNanominaBalance(balance: string): string {
  const normalized = balance.trim();
  if (!normalized) {
    return "0 MINA";
  }

  const amount = BigInt(normalized);
  const whole = amount / NANO_MINA_PER_MINA;
  const fractional = amount % NANO_MINA_PER_MINA;
  const fractionalString = formatFractionalMina(fractional);

  return fractionalString
    ? `${whole.toString()}.${fractionalString} MINA`
    : `${whole.toString()} MINA`;
}

export async function fetchMinaAccountBalanceNanomina(
  minaNodeUrl: string,
  publicKeyBase58: string,
): Promise<string> {
  const { Mina, PublicKey, fetchAccount } = await import("o1js");
  const resolvedMinaNodeUrl = resolveEndpointUrl(minaNodeUrl);

  Mina.setActiveInstance(
    Mina.Network({
      mina: resolvedMinaNodeUrl,
    }),
  );

  const { account, error } = await fetchAccount({
    publicKey: PublicKey.fromBase58(publicKeyBase58),
  });

  if (!account) {
    return "0";
  }

  if (error) {
    throw error;
  }

  return account.balance.toString();
}

export async function fetchMinaAccountBalance(
  minaNodeUrl: string,
  publicKeyBase58: string,
): Promise<string> {
  const balance = await fetchMinaAccountBalanceNanomina(minaNodeUrl, publicKeyBase58);
  return formatNanominaBalance(balance);
}

interface BestChainResponse {
  data?: {
    bestChain?: Array<{
      protocolState?: {
        consensusState?: {
          stakingEpochData?: {
            ledger?: {
              totalCurrency?: string | null;
            } | null;
          } | null;
        } | null;
      } | null;
    }> | null;
  };
  errors?: Array<{ message?: string }>;
}

export async function fetchStakingLedgerTotalCurrency(minaNodeUrl: string): Promise<string> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query {
        bestChain(maxLength: 1) {
          protocolState {
            consensusState {
              stakingEpochData {
                ledger {
                  totalCurrency
                }
              }
            }
          }
        }
      }`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch staking ledger total currency: ${response.status}`);
  }

  const payload = (await response.json()) as BestChainResponse;
  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message).filter(Boolean).join("; ") ||
        "Failed to fetch staking ledger total currency.",
    );
  }

  const totalCurrency =
    payload.data?.bestChain?.[0]?.protocolState?.consensusState?.stakingEpochData?.ledger
      ?.totalCurrency;

  return totalCurrency?.trim() ? formatNanominaBalance(totalCurrency) : "0 MINA";
}
