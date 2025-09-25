import { Field, Poseidon } from "o1js";
// TODO: need a better way to import this
import { prefixToField } from "./../../node_modules/o1js/dist/node/bindings/lib/binable.js";

// hashing helpers
export function initialState() {
  return [Field(0), Field(0), Field(0)] as [Field, Field, Field];
}
export function salt(prefix: string) {
  return Poseidon.update(initialState(), [prefixToField<Field>(Field, prefix)]);
}
export function hashWithPrefix(prefix: string, input: Field[]) {
  let init = salt(prefix);
  return Poseidon.update(init, input)[0];
}
export function emptyHashWithPrefix(prefix: string) {
  return salt(prefix)[0];
}

export const eventPrefix = "MinaZkappEvent******";
export const sequenceEventsPrefix = "MinaZkappSeqEvents**";

export const actionsEmptyHash = emptyHashWithPrefix("MinaZkappActionsEmpty");

export function getActionHash(actionFields: Field[]) {
  return hashWithPrefix(eventPrefix, actionFields);
}

export function appendActionToHashList(
  initialActionsHash: Field,
  actionFields: Field[]
) {
  const actionHash = getActionHash(actionFields);
  return hashWithPrefix(sequenceEventsPrefix, [
    initialActionsHash,
    hashWithPrefix(sequenceEventsPrefix, [actionsEmptyHash, actionHash]),
  ]);
}
