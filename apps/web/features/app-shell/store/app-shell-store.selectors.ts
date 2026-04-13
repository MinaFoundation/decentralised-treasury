import { useAppShellStore } from "./app-shell-store";

export const useAppShellErrorState = () => useAppShellStore((state) => state.error);
