import { TypeSafeClient } from "@typesafe-ai/sdk";
import { KernelError, errorMessage } from "../core/errors.js";
import type { SystemOneRequest, SystemOneResponse } from "../core/types.js";
import { normalizeProviderResponse } from "./response.js";
import type { SystemOneProvider } from "./system-one.js";

export class TypeSafeProvider implements SystemOneProvider {
  private readonly client: TypeSafeClient;

  constructor(
    baseUrl?: string,
    private readonly apiKey = "",
  ) {
    this.client = new TypeSafeClient(baseUrl ? { baseURL: baseUrl } : {});
  }

  async evaluate(
    request: SystemOneRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SystemOneResponse> {
    try {
      const call = this.client.systemOne as unknown as (
        payload: SystemOneRequest,
        callOptions?: { signal?: AbortSignal },
      ) => Promise<unknown>;
      const raw = await call(request, options?.signal ? { signal: options.signal } : undefined);
      return normalizeProviderResponse(raw, "typesafe", request.model);
    } catch (error) {
      if (error instanceof KernelError) throw error;
      const safeMessage = this.apiKey
        ? errorMessage(error).split(this.apiKey).join("[已隐藏]")
        : errorMessage(error);
      throw new KernelError(
        "PROVIDER_ERROR",
        `TypeSafe Provider 调用失败：${safeMessage}`,
        error,
      );
    }
  }
}
