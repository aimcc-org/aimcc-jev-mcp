import { randomUUID } from "node:crypto";
import type {
  DecisionAction,
  DecisionEnvelope,
  DecisionSignal,
  DecisionStatus,
  RuntimeResult,
  Usage,
} from "../core/types.js";
import { snapshotId } from "../snapshot/hash.js";

interface EnvelopeOptions<T> {
  status: DecisionStatus;
  action: DecisionAction;
  reasonCodes: string[];
  data: T;
  signals: DecisionSignal[];
  decisionSpec: string;
  policyProfile: string;
  snapshot: unknown;
  model: string;
  provider: string;
  latencyMs: number;
  usage?: Usage;
  contextTruncated?: boolean;
}

export function decisionEnvelope<T>(options: EnvelopeOptions<T>): DecisionEnvelope<T> {
  return {
    status: options.status,
    decision: { action: options.action, reasonCodes: options.reasonCodes },
    data: options.data,
    signals: options.signals,
    meta: {
      requestId: `req_${randomUUID()}`,
      snapshotId: snapshotId(options.snapshot),
      decisionSpec: options.decisionSpec,
      model: options.model,
      provider: options.provider,
      policyProfile: options.policyProfile,
      latencyMs: options.latencyMs,
      cacheHit: false,
      contextTruncated: options.contextTruncated ?? false,
      ...(options.usage ? { usage: options.usage } : {}),
    },
  };
}

export function runtimeEnvelope<T>(
  runtime: RuntimeResult,
  options: Omit<
    EnvelopeOptions<T>,
    "signals" | "model" | "provider" | "latencyMs" | "usage"
  > & { signals?: DecisionSignal[] },
): DecisionEnvelope<T> {
  return decisionEnvelope({
    ...options,
    signals: options.signals ?? runtime.signals,
    model: runtime.model,
    provider: runtime.provider,
    latencyMs: runtime.latencyMs,
    usage: runtime.usage,
  });
}
