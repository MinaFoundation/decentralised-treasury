import { Task } from "src/proving/task-queue.js";

export interface TestTaskInput {
  foo: string;
}

export interface TestTaskOutput {
  bar: string;
}

export const TestTask: Task<TestTaskInput, TestTaskOutput> = class {
  public static taskName = "test-task";

  public static async prepare() {}

  public static serializers = {
    input: async (input: TestTaskInput) => JSON.stringify(input),
    output: async (output: TestTaskOutput) => JSON.stringify(output),
  };

  public static deserializers = {
    input: async (input: string) => JSON.parse(input) as TestTaskInput,
    output: async (output: string) => JSON.parse(output) as TestTaskOutput,
  };

  public static async run(input: TestTaskInput): Promise<TestTaskOutput> {
    return {
      bar: input.foo,
    };
  }
};
