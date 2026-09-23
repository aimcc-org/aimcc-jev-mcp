import type { DecisionEnvelope, ScoreSignal } from "../../core/types.js";
import { score } from "../../primitives/questions.js";
import { PrimitiveRuntime } from "../../runtime/primitive-runtime.js";
import { runtimeEnvelope } from "../shared.js";
import type { AssessTaskInput } from "./schema.js";

export interface AssessTaskPolicy {
  minimumConfidence: number;
  maximumAutoComplexity: number;
  maximumAutoRisk: number;
  maximumAutoAmbiguity: number;
  profile: string;
}

export interface AssessTaskOutput {
  complexity: number;
  risk: number;
  ambiguity: number;
}

export async function executeAssessTask(
  runtime: PrimitiveRuntime,
  input: AssessTaskInput,
  options: { signal?: AbortSignal; policy: AssessTaskPolicy },
): Promise<DecisionEnvelope<AssessTaskOutput>> {
  const state = input;
  const questions = {
    complexity: score("How complex is this task to execute correctly?", [
      "trivial",
      "moderate",
      "complex",
      "highly complex",
    ]),
    risk: score("How severe is the impact of executing this task incorrectly?", [
      "low risk",
      "moderate risk",
      "high risk",
      "critical risk",
    ]),
    ambiguity: score("How ambiguous or underspecified is this task?", [
      "clear",
      "minor ambiguity",
      "material ambiguity",
      "underspecified",
    ]),
  };
  const result = await runtime.evaluate(
    state,
    questions,
    options.signal ? { signal: options.signal } : undefined,
  );
  const scores = new Map(
    result.signals
      .filter((signal): signal is ScoreSignal => signal.kind === "score")
      .map((signal) => [signal.id, signal]),
  );
  const data: AssessTaskOutput = {
    complexity: scores.get("complexity")?.score ?? 0,
    risk: scores.get("risk")?.score ?? 0,
    ambiguity: scores.get("ambiguity")?.score ?? 0,
  };
  const snapshot = { state, questions, signals: result.signals };
  if (
    result.signals.some((signal) => signal.status === "invalid_response") ||
    scores.size !== 3
  ) {
    return runtimeEnvelope(result, {
      status: "indeterminate",
      action: "system_two_review",
      reasonCodes: ["TASK_ASSESSMENT_INVALID"],
      data,
      decisionSpec: "assess_task@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  if (
    [...scores.values()].some(
      (signal) => (signal.confidence ?? 0) < options.policy.minimumConfidence,
    )
  ) {
    return runtimeEnvelope(result, {
      status: "review_required",
      action: "system_two_review",
      reasonCodes: ["TASK_ASSESSMENT_CONFIDENCE_LOW"],
      data,
      decisionSpec: "assess_task@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  if (data.ambiguity > options.policy.maximumAutoAmbiguity) {
    return runtimeEnvelope(result, {
      status: "insufficient_evidence",
      action: "ask_user",
      reasonCodes: ["TASK_AMBIGUOUS"],
      data,
      decisionSpec: "assess_task@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  if (
    data.complexity > options.policy.maximumAutoComplexity ||
    data.risk > options.policy.maximumAutoRisk
  ) {
    return runtimeEnvelope(result, {
      status: "review_required",
      action: "system_two_review",
      reasonCodes: ["TASK_REQUIRES_DEEP_REASONING"],
      data,
      decisionSpec: "assess_task@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  return runtimeEnvelope(result, {
    status: "resolved",
    action: "continue",
    reasonCodes: ["TASK_SAFE_TO_PROCEED"],
    data,
    decisionSpec: "assess_task@1",
    policyProfile: options.policy.profile,
    snapshot,
  });
}
