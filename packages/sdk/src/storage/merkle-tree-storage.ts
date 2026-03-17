import { Field } from "o1js";

export interface MerkleTreeStorage {
  namespace: string;
  getNode: (level: number, index: bigint) => Promise<Field | undefined>;
  setNode: (level: number, index: bigint, value: Field) => Promise<void>;
  close: () => Promise<void>;
}
