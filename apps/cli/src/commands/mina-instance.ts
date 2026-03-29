import { Mina } from "o1js";

export function configureMinaNetwork(minaNodeUrl: string): void {
  Mina.setActiveInstance(
    Mina.Network({
      mina: minaNodeUrl,
    }),
  );
}
