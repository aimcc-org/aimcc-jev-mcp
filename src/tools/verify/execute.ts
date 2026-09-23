import { randomUUID } from "node:crypto";
import { reduceEvidence } from "../../context/reducer.js";
import type {
  ChoiceSignal,
  DecisionEnvelope,
  Evidence,
  PrimitiveQuestion,
} from "../../core/types.js";
import { choice } from "../../primitives/questions.js";
import { PrimitiveRuntime } from "../../runtime/primitive-runtime.js";
import { snapshotId } from "../../snapshot/hash.js";
import type { VerifyInput } from "./schema.js";
import type { VerificationResult, VerifyOutput } from "./types.js";

export interface VerifyPolicy {
  minimumConfidence: number;
  profile: string;
}

const RELATIONS = {
  supported: "证据直接陈述了该主张，或可以由证据直接推出该主张为真",
  contradicted: "证据陈述了相反事实，或可以由证据直接推出该主张为假",
  not_addressed: "证据没有处理该主张所断言的事实，不能支持也不能反驳",
} as const;

function choiceSignal(
  signals: ChoiceSignal[],
  id: string,
): ChoiceSignal | undefined {
  return signals.find((signal) => signal.id === id);
}

function relationQuestionId(claimId: string): string {
  return `relation_${claimId}`;
}

function sourceQuestionId(claimId: string): string {
  return `source_${claimId}`;
}

function buildQuestions(input: VerifyInput, evidence: Evidence[]): Record<string, PrimitiveQuestion> {
  const questions: Record<string, PrimitiveQuestion> = {};
  for (const claim of input.claims) {
    questions[relationQuestionId(claim.id)] = choice(
      `判断 evidence 与 claim ${claim.id}（${claim.text}）之间的关系。只根据 state 中的证据判断，不使用外部知识。`,
      RELATIONS,
    );
    if (evidence.length > 1) {
      questions[sourceQuestionId(claim.id)] = choice(
        `哪一条 evidence 最直接决定 claim ${claim.id} 的关系判断？`,
        {
          ...Object.fromEntries(evidence.map((item) => [item.id, null])),
          none: "没有任何单条证据直接决定该判断",
        },
      );
    }
  }
  return questions;
}

function resolvePolicy(
  input: VerifyInput,
  results: VerificationResult[],
  relationSignals: ChoiceSignal[],
  contextTruncated: boolean,
  policy: VerifyPolicy,
): Pick<DecisionEnvelope<VerifyOutput>, "status" | "decision"> {
  if (relationSignals.some((signal) => signal.status === "invalid_response")) {
    return {
      status: "indeterminate",
      decision: {
        action: "system_two_review",
        reasonCodes: ["SEMANTIC_RESPONSE_INVALID"],
      },
    };
  }
  if (
    relationSignals.some(
      (signal) => (signal.confidence ?? 0) < policy.minimumConfidence,
    )
  ) {
    return {
      status: "review_required",
      decision: {
        action: "system_two_review",
        reasonCodes: ["SEMANTIC_CONFIDENCE_LOW"],
      },
    };
  }
  const blockingIds = new Set(
    input.claims.filter((claim) => claim.blocking).map((claim) => claim.id),
  );
  if (
    results.some(
      (result) => blockingIds.has(result.claimId) && result.verdict === "contradicted",
    )
  ) {
    return {
      status: "resolved",
      decision: { action: "reject", reasonCodes: ["BLOCKING_CLAIM_CONTRADICTED"] },
    };
  }
  if (
    results.some(
      (result) => blockingIds.has(result.claimId) && result.verdict === "not_addressed",
    )
  ) {
    return {
      status: "insufficient_evidence",
      decision: {
        action: "collect_evidence",
        reasonCodes: ["BLOCKING_CLAIM_NOT_ADDRESSED"],
      },
    };
  }
  if (contextTruncated) {
    return {
      status: "review_required",
      decision: {
        action: "review",
        reasonCodes: ["EVIDENCE_CONTEXT_TRUNCATED"],
      },
    };
  }
  return {
    status: "resolved",
    decision: { action: "accept", reasonCodes: ["ALL_BLOCKING_CLAIMS_SUPPORTED"] },
  };
}

export async function executeVerify(
  runtime: PrimitiveRuntime,
  input: VerifyInput,
  options: { signal?: AbortSignal; policy: VerifyPolicy },
): Promise<DecisionEnvelope<VerifyOutput>> {
  const reduced = reduceEvidence(input.evidence as Evidence[]);
  const questions = buildQuestions(input, reduced.evidence);
  const state = {
    purpose: "只依据 evidence，判断每个 claim 是否得到支持、被反驳或未被处理。",
    claims: input.claims,
    evidence: reduced.evidence,
  };
  const runtimeResult = await runtime.evaluate(
    state,
    questions,
    options?.signal ? { signal: options.signal } : undefined,
  );
  const choiceSignals = runtimeResult.signals.filter(
    (signal): signal is ChoiceSignal => signal.kind === "choice",
  );
  const relationSignals = input.claims
    .map((claim) => choiceSignal(choiceSignals, relationQuestionId(claim.id)))
    .filter((signal): signal is ChoiceSignal => signal !== undefined);

  const results = input.claims.map<VerificationResult>((claim) => {
    const relation = choiceSignal(choiceSignals, relationQuestionId(claim.id));
    const source = choiceSignal(choiceSignals, sourceQuestionId(claim.id));
    const verdict =
      relation?.status === "invalid_response" || relation?.selected === undefined
        ? "indeterminate"
        : (relation.selected as VerificationResult["verdict"]);
    const singleEvidenceId = reduced.evidence[0]?.id;
    const evidenceIds =
      verdict === "not_addressed" || verdict === "indeterminate"
        ? []
        : source?.selected && source.selected !== "none"
          ? [source.selected]
          : reduced.evidence.length === 1 && singleEvidenceId
            ? [singleEvidenceId]
            : [];
    return {
      claimId: claim.id,
      verdict,
      confidence: relation?.confidence ?? 0,
      evidenceIds,
    };
  });
  const decision = resolvePolicy(
    input,
    results,
    relationSignals,
    reduced.truncated,
    options.policy,
  );
  const snapshot = snapshotId({
    spec: "verify@1",
    model: runtimeResult.model,
    state,
    questions,
    signals: runtimeResult.signals,
  });
  return {
    ...decision,
    data: { results },
    signals: runtimeResult.signals,
    meta: {
      requestId: `req_${randomUUID()}`,
      snapshotId: snapshot,
      decisionSpec: "verify@1",
      model: runtimeResult.model,
      provider: runtimeResult.provider,
      policyProfile: options.policy.profile,
      latencyMs: runtimeResult.latencyMs,
      cacheHit: false,
      contextTruncated: reduced.truncated,
      usage: runtimeResult.usage,
    },
  };
}
