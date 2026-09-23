import { KernelError } from "../core/errors.js";
import type { ProviderName, SystemOneResponse } from "../core/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeProviderResponse(
  value: unknown,
  provider: ProviderName,
  fallbackModel: string,
): SystemOneResponse {
  if (!isRecord(value) || !isRecord(value.answers)) {
    throw new KernelError(
      "INVALID_PROVIDER_RESPONSE",
      `${provider} Provider 响应缺少 answers 对象。`,
    );
  }
  const usage = isRecord(value.usage) ? value.usage : {};
  const inputTokens = tokenCount(usage.input_tokens) ?? tokenCount(usage.inputTokens) ?? 0;
  const outputTokens = tokenCount(usage.output_tokens) ?? tokenCount(usage.outputTokens) ?? 0;
  if (value.model !== undefined && typeof value.model !== "string") {
    throw new KernelError(
      "INVALID_PROVIDER_RESPONSE",
      `${provider} Provider 响应中的 model 必须是字符串。`,
    );
  }
  return {
    answers: value.answers,
    usage: { inputTokens, outputTokens },
    provider,
    model: typeof value.model === "string" ? value.model : fallbackModel,
  };
}
