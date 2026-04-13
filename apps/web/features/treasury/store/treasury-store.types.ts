import type { TreasuryNetworkHealthSnapshot } from "@repo/ui/treasury-status-footer";
import type { TreasuryLifecyclePeriodId } from "@repo/ui/treasury-lifecycle-period-info";

export interface TreasuryState {
  paused: boolean;
  balance?: string;
  currentLifecycleId?: number;
  lifecycleStarted?: boolean;
  currentPeriod?: TreasuryLifecyclePeriodId;
  currentPeriodProgress?: number;
  currentGlobalSlot?: number;
  treasuryDeployedAtSlot?: number;
  loading: boolean;
  error: string | null;
  health: TreasuryNetworkHealthSnapshot;
}

export interface TreasuryStoreActions {
  setTreasuryState: (treasury: Partial<TreasuryState>) => void;
  reset: () => void;
}

export type TreasuryStore = TreasuryState & TreasuryStoreActions;
