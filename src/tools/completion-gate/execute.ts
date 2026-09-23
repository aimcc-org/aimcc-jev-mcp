import type { DecisionEnvelope } from "../../core/types.js";
import { PrimitiveRuntime } from "../../runtime/primitive-runtime.js";
import { decisionEnvelope } from "../shared.js";
import { executeVerify } from "../verify/execute.js";
import type { VerificationResult } from "../verify/types.js";
import type { CompletionGateInput } from "./schema.js";

export interface CompletionGatePolicy {
  minimumConfidence: number;
  profile: string;
}

export interface CompletionGateOutput {
  requirements: VerificationResult[];
  checks: CompletionGateInput["checks"];
}

export async function executeCompletionGate(
  runtime: PrimitiveRuntime,
  input: CompletionGateInput,
  options: { signal?: AbortSignal; policy: CompletionGatePolicy },
): Promise<DecisionEnvelope<CompletionGateOutput>> {
  const failedCheck = input.checks.some(
    (check) => check.blocking && check.status === "failed",
  );
  const pendingCheck = input.checks.some(
    (check) => check.blocking && check.status === "not_run",
  );
  if (failedCheck || pendingCheck) {
    return decisionEnvelope({
      status: failedCheck ? "resolved" : "insufficient_evidence",
      action: failedCheck ? "reject" : "run_checks",
      reasonCodes: [failedCheck ? "BLOCKING_CHECK_FAILED" : "BLOCKING_CHECK_NOT_RUN"],
      data: { requirements: [], checks: input.checks },
      signals: [],
      decisionSpec: "completion_gate@1",
      policyProfile: options.policy.profile,
      snapshot: { input, semanticVerification: "not-called" },
      model: "not-called",
      provider: "not-called",
      latencyMs: 0,
    });
  }

  const verification = await executeVerify(
    runtime,
    { claims: input.requirements, evidence: input.evidence },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      policy: options.policy,
    },
  );
  const data: CompletionGateOutput = {
    requirements: verification.data?.results ?? [],
    checks: input.checks,
  };

  return decisionEnvelope({
    status: verification.status,
    action: verification.decision.action,
    reasonCodes: verification.decision.reasonCodes,
    data,
    signals: verification.signals,
    decisionSpec: "completion_gate@1",
    policyProfile: options.policy.profile,
    snapshot: { input, signals: verification.signals },
    model: verification.meta.model,
    provider: verification.meta.provider,
    latencyMs: verification.meta.latencyMs,
    ...(verification.meta.usage ? { usage: verification.meta.usage } : {}),
    contextTruncated: verification.meta.contextTruncated,
  });
}
