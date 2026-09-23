import type { PrimitiveQuestion, RuntimeResult } from "../core/types.js";
import type { SystemOneProvider } from "../providers/system-one.js";
import { validateAnswers } from "./response-validator.js";

export class PrimitiveRuntime {
  constructor(
    private readonly provider: SystemOneProvider,
    private readonly model: string,
  ) {}

  async evaluate(
    state: unknown,
    questions: Record<string, PrimitiveQuestion>,
    options?: { signal?: AbortSignal },
  ): Promise<RuntimeResult> {
    if (Object.keys(questions).length === 0) {
      throw new Error("至少需要一个原子问题。 ");
    }
    const startedAt = performance.now();
    const response = await this.provider.evaluate(
      { state, questions, model: this.model },
      options?.signal ? { signal: options.signal } : undefined,
    );
    return {
      signals: validateAnswers(questions, response.answers),
      usage: response.usage,
      provider: response.provider,
      model: response.model,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
