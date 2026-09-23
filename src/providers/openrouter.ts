import type { SystemOneRequest, SystemOneResponse } from "../core/types.js";
import { postJson, type HttpTransportOptions } from "./http.js";
import { normalizeProviderResponse } from "./response.js";
import type { SystemOneProvider } from "./system-one.js";

export class OpenRouterProvider implements SystemOneProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly transport: HttpTransportOptions,
  ) {}

  async evaluate(
    request: SystemOneRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SystemOneResponse> {
    const model = request.model.startsWith("typesafe/")
      ? request.model
      : `typesafe/${request.model}`;
    const endpoint = `${this.baseUrl.replace(/\/+$/, "")}/alpha/decisions`;
    const raw = await postJson(
      endpoint,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://github.com/aimcc-org/codex-jev-mcp",
          "X-Title": "codex-jev-mcp",
          "X-OpenRouter-Title": "codex-jev-mcp",
        },
        body: { ...request, model },
        secret: this.apiKey,
        providerLabel: "OpenRouter Decisions API",
      },
      this.transport,
      options?.signal,
    );
    return normalizeProviderResponse(raw, "openrouter", model);
  }
}
