export type KernelErrorCode =
  | "CONFIGURATION_ERROR"
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_PROVIDER_RESPONSE";

export class KernelError extends Error {
  constructor(
    public readonly code: KernelErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "KernelError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
