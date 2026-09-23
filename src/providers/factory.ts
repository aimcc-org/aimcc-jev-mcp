import type { RuntimeConfig } from "../config/env.js";
import { KernelError } from "../core/errors.js";
import { CompatibleProvider } from "./compatible.js";
import { LocalOpenJevProvider } from "./local-open-jev.js";
import { OpenRouterProvider } from "./openrouter.js";
import type { SystemOneProvider } from "./system-one.js";
import { TypeSafeProvider } from "./typesafe.js";

export function createProvider(config: RuntimeConfig): SystemOneProvider {
  const transport = {
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    maxResponseBytes: config.maxResponseBytes,
  };
  switch (config.provider) {
    case "typesafe":
      return new TypeSafeProvider(config.typesafeBaseUrl, config.typesafeApiKey);
    case "openrouter":
      if (!config.openRouterApiKey) {
        throw new KernelError("CONFIGURATION_ERROR", "缺少 OPENROUTER_API_KEY。 ");
      }
      return new OpenRouterProvider(
        config.openRouterApiKey,
        config.openRouterBaseUrl,
        transport,
      );
    case "compatible":
      if (!config.compatibleApiKey || !config.compatibleBaseUrl) {
        throw new KernelError(
          "CONFIGURATION_ERROR",
          "Jev 兼容端点需要 JEV_API_KEY 和 JEV_API_BASE_URL。",
        );
      }
      return new CompatibleProvider(
        config.compatibleBaseUrl,
        config.compatibleApiKey,
        transport,
      );
    case "local":
      return new LocalOpenJevProvider({
        modelId: config.model,
        repo: config.localModelRepo,
        dtype: config.localDtype,
      });
  }
}
