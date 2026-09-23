import type { DecisionEnvelope, NoulSignal } from "../../core/types.js";
import { noul } from "../../primitives/questions.js";
import { PrimitiveRuntime } from "../../runtime/primitive-runtime.js";
import { runtimeEnvelope } from "../shared.js";
import type { ScreenContentInput } from "./schema.js";

export interface ScreenContentPolicy {
  reviewProbability: number;
  blockProbability: number;
  profile: string;
}

export interface ScreenRuleResult {
  id: string;
  action: "review" | "block";
  probability: number;
}

export interface ScreenContentOutput {
  rules: ScreenRuleResult[];
}

function ruleQuestionId(id: string): string {
  return `rule.${id}`;
}

export async function executeScreenContent(
  runtime: PrimitiveRuntime,
  input: ScreenContentInput,
  options: { signal?: AbortSignal; policy: ScreenContentPolicy },
): Promise<DecisionEnvelope<ScreenContentOutput>> {
  const state = { content: input.content };
  const questions = Object.fromEntries(
    input.rules.map((rule) => [
      ruleQuestionId(rule.id),
      noul(`Does the content match this screening rule: ${rule.description}`, {
        true: "The content matches the rule.",
        false: "The content does not match the rule.",
      }),
    ]),
  );
  const result = await runtime.evaluate(
    state,
    questions,
    options.signal ? { signal: options.signal } : undefined,
  );
  const signals = new Map(
    result.signals
      .filter((signal): signal is NoulSignal => signal.kind === "noul")
      .map((signal) => [signal.id, signal]),
  );
  const data: ScreenContentOutput = {
    rules: input.rules.map((rule) => ({
      id: rule.id,
      action: rule.action,
      probability: signals.get(ruleQuestionId(rule.id))?.probabilityTrue ?? 0,
    })),
  };
  const snapshot = { state, rules: input.rules, questions, signals: result.signals };
  if (
    result.signals.some((signal) => signal.status === "invalid_response") ||
    signals.size !== input.rules.length
  ) {
    return runtimeEnvelope(result, {
      status: "indeterminate",
      action: "system_two_review",
      reasonCodes: ["CONTENT_SCREEN_RESPONSE_INVALID"],
      data,
      decisionSpec: "screen_content@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  if (
    data.rules.some(
      (rule) => rule.action === "block" && rule.probability >= options.policy.blockProbability,
    )
  ) {
    return runtimeEnvelope(result, {
      status: "resolved",
      action: "reject",
      reasonCodes: ["CONTENT_BLOCK_RULE_MATCHED"],
      data,
      decisionSpec: "screen_content@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  if (
    data.rules.some((rule) => rule.probability >= options.policy.reviewProbability)
  ) {
    return runtimeEnvelope(result, {
      status: "review_required",
      action: "review",
      reasonCodes: ["CONTENT_REVIEW_RULE_MATCHED"],
      data,
      decisionSpec: "screen_content@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  return runtimeEnvelope(result, {
    status: "resolved",
    action: "accept",
    reasonCodes: ["CONTENT_SCREEN_CLEAR"],
    data,
    decisionSpec: "screen_content@1",
    policyProfile: options.policy.profile,
    snapshot,
  });
}
