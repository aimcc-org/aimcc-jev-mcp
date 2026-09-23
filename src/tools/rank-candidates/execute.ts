import type { ChoiceSignal, DecisionEnvelope } from "../../core/types.js";
import { choice } from "../../primitives/questions.js";
import { PrimitiveRuntime } from "../../runtime/primitive-runtime.js";
import { runtimeEnvelope } from "../shared.js";
import type { RankCandidatesInput } from "./schema.js";

export interface RankCandidatesPolicy {
  minimumConfidence: number;
  minimumMargin: number;
  profile: string;
}

export interface RankedCandidate {
  id: string;
  probability: number;
  rank: number;
}

export interface RankCandidatesOutput {
  selectedId?: string;
  ranking: RankedCandidate[];
}

export async function executeRankCandidates(
  runtime: PrimitiveRuntime,
  input: RankCandidatesInput,
  options: { signal?: AbortSignal; policy: RankCandidatesPolicy },
): Promise<DecisionEnvelope<RankCandidatesOutput>> {
  const question = choice(
    "Which candidate best satisfies the objective? Consider only the supplied objective and candidate descriptions.",
    Object.fromEntries(input.candidates.map((candidate) => [candidate.id, candidate.description])),
  );
  const state = { objective: input.objective, candidates: input.candidates };
  const questions = { ranking: question };
  const result = await runtime.evaluate(
    state,
    questions,
    options.signal ? { signal: options.signal } : undefined,
  );
  const signal = result.signals[0] as ChoiceSignal | undefined;
  const ranking = input.candidates
    .map((candidate) => ({
      id: candidate.id,
      probability: signal?.probabilities?.[candidate.id] ?? 0,
    }))
    .sort((left, right) => right.probability - left.probability)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const data: RankCandidatesOutput = {
    ...(signal?.selected ? { selectedId: signal.selected } : {}),
    ranking,
  };

  if (!signal || signal.status === "invalid_response") {
    return runtimeEnvelope(result, {
      status: "indeterminate",
      action: "system_two_review",
      reasonCodes: ["RANKING_RESPONSE_INVALID"],
      data,
      decisionSpec: "rank_candidates@1",
      policyProfile: options.policy.profile,
      snapshot: { state, questions, signals: result.signals },
    });
  }
  if (
    (signal.confidence ?? 0) < options.policy.minimumConfidence ||
    (signal.margin ?? 0) < options.policy.minimumMargin
  ) {
    return runtimeEnvelope(result, {
      status: "review_required",
      action: "system_two_review",
      reasonCodes: ["RANKING_CONFIDENCE_LOW"],
      data,
      decisionSpec: "rank_candidates@1",
      policyProfile: options.policy.profile,
      snapshot: { state, questions, signals: result.signals },
    });
  }
  return runtimeEnvelope(result, {
    status: "resolved",
    action: "continue",
    reasonCodes: ["CANDIDATE_RANKED"],
    data,
    decisionSpec: "rank_candidates@1",
    policyProfile: options.policy.profile,
    snapshot: { state, questions, signals: result.signals },
  });
}
