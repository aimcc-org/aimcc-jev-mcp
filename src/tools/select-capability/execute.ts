import type {
  ChoiceSignal,
  DecisionEnvelope,
  NoulSignal,
  RuntimeResult,
} from "../../core/types.js";
import { choice, noul } from "../../primitives/questions.js";
import { PrimitiveRuntime } from "../../runtime/primitive-runtime.js";
import { decisionEnvelope, runtimeEnvelope } from "../shared.js";
import type { SelectCapabilityInput } from "./schema.js";

export interface SelectCapabilityPolicy {
  minimumRelevance: number;
  minimumConfidence: number;
  minimumMargin: number;
  profile: string;
}

export interface CapabilityAssessment {
  id: string;
  available: boolean;
  relevance: number;
}

export interface SelectCapabilityOutput {
  selectedId?: string;
  assessments: CapabilityAssessment[];
}

function relevanceId(id: string): string {
  return `relevance.${id}`;
}

export async function executeSelectCapability(
  runtime: PrimitiveRuntime,
  input: SelectCapabilityInput,
  options: { signal?: AbortSignal; policy: SelectCapabilityPolicy },
): Promise<DecisionEnvelope<SelectCapabilityOutput>> {
  const available = input.capabilities.filter((capability) => capability.available);
  const emptyData: SelectCapabilityOutput = {
    assessments: input.capabilities.map((capability) => ({
      id: capability.id,
      available: capability.available,
      relevance: 0,
    })),
  };
  if (available.length === 0) {
    return decisionEnvelope({
      status: "insufficient_evidence",
      action: "ask_user",
      reasonCodes: ["NO_CAPABILITY_AVAILABLE"],
      data: emptyData,
      signals: [],
      decisionSpec: "select_capability@1",
      policyProfile: options.policy.profile,
      snapshot: { task: input.task, capabilities: input.capabilities },
      model: "not-called",
      provider: "not-called",
      latencyMs: 0,
    });
  }

  const state = { task: input.task, capabilities: available };
  const relevanceQuestions = Object.fromEntries(
    available.map((capability) => [
      relevanceId(capability.id),
      noul(
        `Can capability ${capability.id} directly help execute the task?`,
        { true: capability.description, false: "This capability does not fit the task." },
      ),
    ]),
  );
  const first = await runtime.evaluate(
    state,
    relevanceQuestions,
    options.signal ? { signal: options.signal } : undefined,
  );
  const relevanceSignals = first.signals.filter(
    (signal): signal is NoulSignal => signal.kind === "noul",
  );
  const byId = new Map(relevanceSignals.map((signal) => [signal.id, signal]));
  const assessments = input.capabilities.map((capability) => ({
    id: capability.id,
    available: capability.available,
    relevance: byId.get(relevanceId(capability.id))?.probabilityTrue ?? 0,
  }));
  const baseData: SelectCapabilityOutput = { assessments };

  if (relevanceSignals.some((signal) => signal.status === "invalid_response")) {
    return runtimeEnvelope(first, {
      status: "indeterminate",
      action: "system_two_review",
      reasonCodes: ["CAPABILITY_RELEVANCE_INVALID"],
      data: baseData,
      decisionSpec: "select_capability@1",
      policyProfile: options.policy.profile,
      snapshot: { state, questions: relevanceQuestions, signals: first.signals },
    });
  }

  const eligible = available.filter(
    (capability) =>
      (byId.get(relevanceId(capability.id))?.probabilityTrue ?? 0) >=
      options.policy.minimumRelevance,
  );
  if (eligible.length === 0) {
    return runtimeEnvelope(first, {
      status: "review_required",
      action: "system_two_review",
      reasonCodes: ["NO_RELEVANT_CAPABILITY"],
      data: baseData,
      decisionSpec: "select_capability@1",
      policyProfile: options.policy.profile,
      snapshot: { state, questions: relevanceQuestions, signals: first.signals },
    });
  }
  if (eligible.length === 1) {
    return runtimeEnvelope(first, {
      status: "resolved",
      action: "continue",
      reasonCodes: ["CAPABILITY_SELECTED"],
      data: { ...baseData, selectedId: eligible[0]!.id },
      decisionSpec: "select_capability@1",
      policyProfile: options.policy.profile,
      snapshot: { state, questions: relevanceQuestions, signals: first.signals },
    });
  }

  const selectionQuestions = {
    selection: choice(
      "Which eligible capability is the best primary capability for executing the task?",
      Object.fromEntries(eligible.map((capability) => [capability.id, capability.description])),
    ),
  };
  const second = await runtime.evaluate(
    { task: input.task, capabilities: eligible },
    selectionQuestions,
    options.signal ? { signal: options.signal } : undefined,
  );
  const selection = second.signals[0] as ChoiceSignal | undefined;
  const combined: RuntimeResult = {
    signals: [...first.signals, ...second.signals],
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    },
    provider: second.provider,
    model: second.model,
    latencyMs: first.latencyMs + second.latencyMs,
  };
  const data: SelectCapabilityOutput = {
    ...baseData,
    ...(selection?.selected ? { selectedId: selection.selected } : {}),
  };
  const snapshot = {
    state,
    relevanceQuestions,
    selectionQuestions,
    signals: combined.signals,
  };
  if (!selection || selection.status === "invalid_response") {
    return runtimeEnvelope(combined, {
      status: "indeterminate",
      action: "system_two_review",
      reasonCodes: ["CAPABILITY_SELECTION_INVALID"],
      data,
      decisionSpec: "select_capability@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  if (
    (selection.confidence ?? 0) < options.policy.minimumConfidence ||
    (selection.margin ?? 0) < options.policy.minimumMargin
  ) {
    return runtimeEnvelope(combined, {
      status: "review_required",
      action: "system_two_review",
      reasonCodes: ["CAPABILITY_SELECTION_CONFIDENCE_LOW"],
      data,
      decisionSpec: "select_capability@1",
      policyProfile: options.policy.profile,
      snapshot,
    });
  }
  return runtimeEnvelope(combined, {
    status: "resolved",
    action: "continue",
    reasonCodes: ["CAPABILITY_SELECTED"],
    data,
    decisionSpec: "select_capability@1",
    policyProfile: options.policy.profile,
    snapshot,
  });
}
