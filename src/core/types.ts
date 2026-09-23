export type ProviderName = "typesafe" | "openrouter" | "compatible" | "local";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number;
}

export interface SystemOneRequest {
  state: unknown;
  questions: Record<string, PrimitiveQuestion>;
  model: string;
}

export interface SystemOneResponse {
  answers: Record<string, unknown>;
  usage: Usage;
  provider: ProviderName;
  model: string;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: {
    true: string;
    false: string;
  };
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type PrimitiveQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export type SignalStatus = "valid" | "low_confidence" | "invalid_response";

interface BaseSignal {
  id: string;
  status: SignalStatus;
  questionVersion: string;
}

export interface ChoiceSignal extends BaseSignal {
  kind: "choice";
  selected?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  margin?: number;
  errorCode?: string;
}

export interface NoulSignal extends BaseSignal {
  kind: "noul";
  probabilityTrue?: number;
  errorCode?: string;
}

export interface ScoreSignal extends BaseSignal {
  kind: "score";
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  errorCode?: string;
}

export type DecisionSignal = ChoiceSignal | NoulSignal | ScoreSignal;

export type DecisionStatus =
  | "resolved"
  | "review_required"
  | "insufficient_evidence"
  | "indeterminate"
  | "invalid_input"
  | "provider_error";

export type DecisionAction =
  | "accept"
  | "continue"
  | "reject"
  | "review"
  | "ask_user"
  | "collect_evidence"
  | "run_checks"
  | "system_two_review"
  | "escalate";

export interface DecisionEnvelope<T> {
  status: DecisionStatus;
  decision: {
    action: DecisionAction;
    reasonCodes: string[];
  };
  data?: T;
  signals: DecisionSignal[];
  meta: {
    requestId: string;
    snapshotId: string;
    decisionSpec: string;
    model: string;
    provider: string;
    policyProfile: string;
    latencyMs: number;
    cacheHit: boolean;
    contextTruncated: boolean;
    usage?: Usage;
  };
}

export interface Evidence {
  id: string;
  type:
    | "text"
    | "diff"
    | "test"
    | "lint"
    | "typecheck"
    | "build"
    | "file"
    | "log"
    | "screenshot"
    | "other";
  text: string;
  provenance?: {
    path?: string;
    command?: string;
    uri?: string;
    generatedBy?: "client" | "tool" | "user" | "unknown";
  };
  hash?: string;
  timestamp?: string;
}

export interface RuntimeResult {
  signals: DecisionSignal[];
  usage: Usage;
  provider: ProviderName;
  model: string;
  latencyMs: number;
}
