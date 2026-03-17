import { SideLoadedVoteReducerProof } from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { KeyvCounter, KeyvKeyValueStorage } from "./keyv-key-value-storage.js";
import { VoteReducerProofStorage } from "../vote-reducer-proof-storage.js";
import { Keyv } from "keyv";
import { KeyValueEntry } from "../key-value-storage.js";

export type KeyvFactory = () => Keyv;

export class KeyvVoteReducerProofStorage implements VoteReducerProofStorage {
  public storage: KeyvKeyValueStorage;
  public mergedStorage: KeyvKeyValueStorage;
  public mergeStorage: KeyvKeyValueStorage;
  public entries: Array<KeyValueEntry> = [];

  constructor(keyvFactory: KeyvFactory, namespace: string, keyvCounter: KeyvCounter) {
    this.storage = new KeyvKeyValueStorage(
      keyvFactory(),
      keyvCounter,
      `${namespace}`,
    );
    this.mergedStorage = new KeyvKeyValueStorage(
      keyvFactory(),
      keyvCounter,
      `${namespace}-merged`,
    );
    this.mergeStorage = new KeyvKeyValueStorage(
      keyvFactory(),
      keyvCounter,
      `${namespace}-merge`,
    );
  }

  async getProof(id: string): Promise<SideLoadedVoteReducerProof | undefined> {
    const proof = await this.storage.get(id);
    return proof
      ? SideLoadedVoteReducerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setProof(id: string, proof: SideLoadedVoteReducerProof): Promise<void> {
    this.entries.push({
      key: `${this.storage.namespace}:${id}`,
      value: JSON.stringify(proof.toJSON()),
    });
  }

  async getMergeProof(
    id: string,
  ): Promise<SideLoadedVoteReducerProof | undefined> {
    const proof = await this.mergeStorage.get(id);
    return proof
      ? SideLoadedVoteReducerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setMergeProof(
    id: string,
    proof: SideLoadedVoteReducerProof,
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
