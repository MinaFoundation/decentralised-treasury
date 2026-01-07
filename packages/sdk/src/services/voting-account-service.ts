import { Capturable } from "../utils/context-provider.js";
import { VotingAccount } from "../provable/staking-ledger-to-voting-ledger.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  MerkleTree256InMemoryService,
  MerkleTree256Service,
} from "./merkle-tree-service.js";
import { Poseidon, Provable, PublicKey, UInt64 } from "o1js";

export class VotingAccountService {
  public getVotingAccount: (publicKey: string) => Promise<VotingAccount>;
  public setVotingAccount: (
    publicKey: string,
    votingAccount: VotingAccount
  ) => Promise<void>;
}

export class PrefilledVotingAccountInMemoryService
  implements VotingAccountService
{
  public votingAccounts: Record<string, VotingAccount[] | undefined> = {};

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    const votingAccounts = this.votingAccounts[publicKey] ?? [];
    const votingAccount = votingAccounts.shift() ?? VotingAccount.dummy();
    this.votingAccounts[publicKey] = votingAccounts;
    return votingAccount ?? VotingAccount.dummy();
  }

  public async prefillVotingAccounts(
    publicKey: string,
    votingAccounts: VotingAccount[]
  ): Promise<void> {
    this.votingAccounts[publicKey] = votingAccounts;
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {}
}

export class VotingAccountInMemoryService
  implements VotingAccountService, Capturable<Record<string, VotingAccount[]>>
{
  public votingAccounts: Record<string, VotingAccount | undefined> = {};
  public captured: Record<string, VotingAccount[]> = {};

  public toJSON(): string {
    return JSON.stringify(this.votingAccounts);
  }

  public toFile(path: string): void {
    mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(path, this.toJSON());
  }

  public static fromFile(path: string): VotingAccountInMemoryService {
    const votingAccounts = JSON.parse(readFileSync(path, "utf8"));
    const votingAccountService = new VotingAccountInMemoryService();
    votingAccountService.votingAccounts = votingAccounts;
    return votingAccountService;
  }

  public async toMerkleTreeService(): Promise<MerkleTree256InMemoryService> {
    const merkleTreeService = new MerkleTree256InMemoryService();

    for (const [publicKey, votingAccount] of Object.entries(
      this.votingAccounts
    )) {
      let publicKeyObj: PublicKey;
      // TODO: fromBase58 fails for empty public keys, figure out why the voting ledger even contains an empty public key
      try {
        publicKeyObj = PublicKey.fromBase58(publicKey);
      } catch (error) {
        publicKeyObj = PublicKey.empty();
      }
      await merkleTreeService.setLeaf(
        Poseidon.hash(publicKeyObj.toFields()).toBigInt(),
        Poseidon.hash(
          VotingAccount.toFields(
            new VotingAccount({
              balance: UInt64.from(votingAccount.balance),
            })
          )
        )
      );
    }

    return merkleTreeService;
  }

  public startCapture(): void {
    this.captured = {};
  }

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    const votingAccount =
      this.votingAccounts[publicKey] ?? VotingAccount.dummy();
    this.captured[publicKey] ??= [];
    this.captured[publicKey].push(votingAccount);
    return votingAccount;
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    this.votingAccounts[publicKey] = votingAccount;
  }
}
