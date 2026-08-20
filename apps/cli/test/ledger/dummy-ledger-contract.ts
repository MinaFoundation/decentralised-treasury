import { Field, method, SmartContract, state, State } from "o1js";

/** Small state change used by the Ledger LocalBlockchain test. */
export class DummyLedgerContract extends SmartContract {
  @state(Field) counter = State<Field>();

  public init(): void {
    super.init();
    this.counter.set(Field(0));
  }

  @method
  public async increment(): Promise<void> {
    const current = this.counter.getAndRequireEquals();
    this.counter.set(current.add(1));
  }
}
