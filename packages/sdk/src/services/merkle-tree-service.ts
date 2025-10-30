import {
  Field,
  MerkleTree,
  MerkleWitness,
  PrefixedMerkleTree,
  PrefixedMerkleWitness,
} from "o1js";
import {
  accountHashPrefix,
  Account,
  packToFields,
} from "../provable/account.js";
import { hashWithPrefix } from "../provable/hashing-helpers.js";
import { Capturable } from "../providers/context-provider.js";

export class PrefixedMerkleWitness36 extends PrefixedMerkleWitness(36) {}
export class MerkleWitness256 extends MerkleWitness(256) {}

export interface PrefixedMerkleTree36Service {
  getWitness: (index: bigint) => Promise<PrefixedMerkleWitness36>;
  setLeaf: (index: bigint, leaf: Field) => Promise<void>;
}

export interface MerkleTree256Service {
  getWitness: (index: bigint) => Promise<MerkleWitness256>;
  setLeaf: (index: bigint, leaf: Field) => Promise<void>;
}

export const accountLedgerHashPrefixes = [
  "MinaMklTree000******",
  "MinaMklTree001******",
  "MinaMklTree002******",
  "MinaMklTree003******",
  "MinaMklTree004******",
  "MinaMklTree005******",
  "MinaMklTree006******",
  "MinaMklTree007******",
  "MinaMklTree008******",
  "MinaMklTree009******",
  "MinaMklTree010******",
  "MinaMklTree011******",
  "MinaMklTree012******",
  "MinaMklTree013******",
  "MinaMklTree014******",
  "MinaMklTree015******",
  "MinaMklTree016******",
  "MinaMklTree017******",
  "MinaMklTree018******",
  "MinaMklTree019******",
  "MinaMklTree020******",
  "MinaMklTree021******",
  "MinaMklTree022******",
  "MinaMklTree023******",
  "MinaMklTree024******",
  "MinaMklTree025******",
  "MinaMklTree026******",
  "MinaMklTree027******",
  "MinaMklTree028******",
  "MinaMklTree029******",
  "MinaMklTree030******",
  "MinaMklTree031******",
  "MinaMklTree032******",
  "MinaMklTree033******",
  "MinaMklTree034******",
];

export class PrefilledPrefixedMerkleTree36InMemoryService
  implements PrefixedMerkleTree36Service
{
  public witnesses: Record<string, PrefixedMerkleWitness36[]> = {};

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    const witnesses = this.witnesses[index.toString()];
    const witness = witnesses.shift() ?? PrefixedMerkleWitness36.empty();
    this.witnesses[index.toString()] = witnesses;
    return witness;
  }

  public async setWitness(
    index: bigint,
    witness: PrefixedMerkleWitness36
  ): Promise<void> {
    this.witnesses[index.toString()] ??= [];
    this.witnesses[index.toString()].push(witness);
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    console.log("skipping set leaf on prefilled merkle tree provider", index);
    // throw new Error("Unable to set leaf on prefilled merkle tree provider");
  }
}

const emptyAccount = Account.empty();
const hashInput = Account.toHashInput(emptyAccount);
const fields = packToFields(hashInput);
const emptyAccountHash = hashWithPrefix(accountHashPrefix, fields);

export class PrefixedMerkleTree36InMemoryService
  implements
    PrefixedMerkleTree36Service,
    Capturable<Record<string, PrefixedMerkleWitness36>>
{
  public tree: PrefixedMerkleTree = new PrefixedMerkleTree(
    36,
    emptyAccountHash,
    accountLedgerHashPrefixes
  );

  public captured: Record<string, PrefixedMerkleWitness36> = {};

  public startCapture(): void {
    this.captured = {};
  }

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    const witness = new PrefixedMerkleWitness36(
      this.tree.getWitness(index) ?? PrefixedMerkleWitness36.empty()
    );
    this.captured[index.toString()] = witness;
    return witness;
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    this.tree.setLeaf(index, leaf);
  }
}

export class PrefilledMerkleTree256InMemoryService
  implements MerkleTree256Service
{
  public witnesses: Record<string, MerkleWitness256[]> = {};

  public getWitness(index: bigint): Promise<MerkleWitness256> {
    const witnesses = this.witnesses[index.toString()];
    const witness = witnesses.shift();
    this.witnesses[index.toString()] = witnesses;

    return witness ?? MerkleWitness256.empty();
  }

  public async setWitness(
    index: bigint,
    witness: MerkleWitness256
  ): Promise<void> {
    const witnesses = this.witnesses[index.toString()] ?? [];
    witnesses.push(witness);
    this.witnesses[index.toString()] = witnesses;
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    console.log("skipping set leaf on prefilled merkle tree provider", index);
    // throw new Error("Unable to set leaf on prefilled merkle tree provider");
  }
}

export class MerkleTree256InMemoryService
  implements
    MerkleTree256Service,
    Capturable<Record<string, MerkleWitness256[]>>
{
  public tree: MerkleTree = new MerkleTree(256);
  public captured: Record<string, MerkleWitness256[]> = {};

  public startCapture(): void {
    this.captured = {};
  }

  public async getWitness(
    index: bigint
  ): Promise<MerkleWitness256 | undefined> {
    const witness = new MerkleWitness256(
      this.tree.getWitness(index) ?? MerkleWitness256.empty()
    );
    this.captured[index.toString()] ??= [];
    this.captured[index.toString()].push(witness);
    return witness;
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    this.tree.setLeaf(index, leaf);
  }
}
