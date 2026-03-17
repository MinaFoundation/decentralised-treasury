import { SideLoadedStakingLedgerToVotingLedgerProof } from "../../provable/staking-ledger-to-voting-ledger.js";
import { StakingLedgerToVotingLedgerProofStorage } from "../staking-ledger-to-voting-ledger-proof-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";
import { KeyValueEntry } from "../key-value-storage.js";

export type KeyvFactory = () => Keyv;

export class KeyvStakingLedgerToVotingLedgerProofStorage
  implements StakingLedgerToVotingLedgerProofStorage
{
  public storage: KeyvKeyValueStorage;
  public mergedStorage: KeyvKeyValueStorage;
  public mergeStorage: KeyvKeyValueStorage;
  public entries: Array<KeyValueEntry> = [];

  constructor(
    keyvFactory: KeyvFactory,
    namespace: string,
    counter: KeyvNamespaceCounter,
  ) {
    this.storage = new KeyvKeyValueStorage(
      keyvFactory(),
      `${namespace}`,
      counter,
    );
    this.mergedStorage = new KeyvKeyValueStorage(
      keyvFactory(),
      `${namespace}-merged`,
      counter,
    );
    this.mergeStorage = new KeyvKeyValueStorage(
      keyvFactory(),
      `${namespace}-merge`,
      counter,
    );
  }

  async getProof(
    id: string,
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined> {
    const proof = await this.storage.get(id);
    return proof
      ? SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof,
  ): Promise<void> {
    this.entries.push({
      key: `${this.storage.namespace}:${id}`,
      value: JSON.stringify(proof.toJSON()),
    });
  }

  async getMergeProof(
    id: string,
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined> {
    const proof = await this.mergeStorage.get(id);
    return proof
      ? SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setMergeProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof,
  ): Promise<void> {
    this.entries.push({
      key: `${this.mergeStorage.namespace}:${id}`,
      value: JSON.stringify(proof.toJSON()),
    });
  }

  async markAsMerged(id: string): Promise<void> {
    this.entries.push({
      key: `${this.mergedStorage.namespace}:${id}`,
      value: "true",
    });
  }

  async isMerged(id: string): Promise<boolean> {
    const merged = await this.mergedStorage.get(id);
    return merged === "true";
  }

  async mergeCount(): Promise<number> {
    return await this.mergeStorage.count();
  }

  async count(): Promise<number> {
    return await this.storage.count();
  }

  collectEntries(): Array<KeyValueEntry> {
    return this.entries;
  }

  clearEntries(): void {
    this.entries = [];
  }

  async close(): Promise<void> {
    await this.storage.close();
    await this.mergeStorage.close();
    await this.mergedStorage.close();
  }
}
