import type { SystemOneRequest, SystemOneResponse } from "../core/types.js";
import { postJson, type HttpTransportOptions } from "./http.js";
import { normalizeProviderResponse } from "./response.js";
import type { SystemOneProvider } from "./system-one.js";

export class CompatibleProvider implements SystemOneProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly transport: HttpTransportOptions,
  ) {}

  async evaluate(
    request: SystemOneRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SystemOneResponse> {
    const raw = await postJson(
      this.endpoint,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: request,
        secret: this.apiKey,
        providerLabel: "Jev 兼容端点",
      },
      this.transport,
      options?.signal,
    );
    return normalizeProviderResponse(raw, "compatible", request.model);
  }
}
