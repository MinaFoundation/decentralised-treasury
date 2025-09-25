export class ContextProvider<Context> {
  public context: Context | undefined;

  public get(): Context {
    if (!this.context) {
      throw new Error("Context not set");
    }
    return this.context;
  }

  public set(context: Context): void {
    this.context = context;
  }
}
