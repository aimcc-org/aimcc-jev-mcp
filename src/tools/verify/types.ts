export type VerificationVerdict =
  | "supported"
  | "contradicted"
  | "not_addressed"
  | "indeterminate";

export interface VerificationResult {
  claimId: string;
  verdict: VerificationVerdict;
  confidence: number;
  evidenceIds: string[];
}

export interface VerifyOutput {
  results: VerificationResult[];
}
