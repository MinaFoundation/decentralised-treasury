declare module "@repo/sdk/src/provable/contracts/treasury-owner" {
  export class TreasuryOwnerSmartContract {
    treasuryDeployedAtSlot: {
      fetch(): Promise<{ toString(): string } | undefined>;
    };

    constructor(address: unknown);
  }
}

declare module "@repo/sdk/src/provable/contracts/treasury-owner.js" {
  export class TreasuryOwnerSmartContract {
    treasuryDeployedAtSlot: {
      fetch(): Promise<{ toString(): string } | undefined>;
    };
    pauseControllerPublicKey: {
      fetch(): Promise<{ toBase58(): string } | undefined>;
    };

    constructor(address: unknown);
  }
}

declare module "@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js" {
  export class TreasuryPauseControllerSmartContract {
    paused: {
      fetch(): Promise<{ toBoolean(): boolean } | undefined>;
    };

    constructor(address: unknown);
  }
}
