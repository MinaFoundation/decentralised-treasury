import { useTreasuryStore } from "./treasury-store";

export const useTreasuryState = () => useTreasuryStore((state) => state);
