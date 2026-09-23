import { KernelError } from "../core/errors.js";
import type { ProviderName } from "../core/types.js";

export interface RuntimeConfig {
  provider: ProviderName;
  model: string;
  timeoutMs: number;
  maxAttempts: number;
  maxResponseBytes: number;
  typesafeApiKey?: string;
  typesafeBaseUrl?: string;
  openRouterApiKey?: string;
  openRouterBaseUrl: string;
  compatibleApiKey?: string;
  compatibleBaseUrl?: string;
  localModelRepo: string;
  localDtype: "q4" | "q4f16" | "fp16" | "fp32";
}

export const LOCAL_MODEL_ID = "com-kotobalabs/open-jev-deberta-v3-large";
export const LOCAL_MODEL_REPO = "onnx-community/open-jev-deberta-v3-large-ONNX";

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new KernelError(
      "CONFIGURATION_ERROR",
      `环境变量 ${name} 必须是 1 到 ${maximum} 之间的整数。`,
    );
  }
  return value;
}

function resolveProvider(env: NodeJS.ProcessEnv): ProviderName {
  const explicit = (env.JEV_PROVIDER ?? "auto").toLowerCase();
  const supported = new Set(["auto", "typesafe", "openrouter", "compatible", "local"]);
  if (!supported.has(explicit)) {
    throw new KernelError(
      "CONFIGURATION_ERROR",
      "JEV_PROVIDER 仅支持 auto、typesafe、openrouter、compatible 或 local。",
    );
  }

  if (explicit !== "auto") return explicit as ProviderName;
  if (env.TYPESAFE_API_KEY) return "typesafe";
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.JEV_API_KEY && env.JEV_API_BASE_URL) return "compatible";
  return "local";
}

function localDtype(env: NodeJS.ProcessEnv): RuntimeConfig["localDtype"] {
  const value = env.JEV_LOCAL_DTYPE ?? "q4";
  if (value === "q4" || value === "q4f16" || value === "fp16" || value === "fp32") {
    return value;
  }
  throw new KernelError(
    "CONFIGURATION_ERROR",
    "JEV_LOCAL_DTYPE 仅支持 q4、q4f16、fp16 或 fp32。",
  );
}

function requireValue(env: NodeJS.ProcessEnv, name: string, provider: ProviderName): string {
  const value = env[name];
  if (!value) {
    throw new KernelError(
      "CONFIGURATION_ERROR",
      `使用 ${provider} Provider 时必须配置环境变量 ${name}。`,
    );
  }
  return value;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const provider = resolveProvider(env);
  if (provider === "typesafe") requireValue(env, "TYPESAFE_API_KEY", provider);
  if (provider === "openrouter") requireValue(env, "OPENROUTER_API_KEY", provider);
  if (provider === "compatible") {
    requireValue(env, "JEV_API_KEY", provider);
    requireValue(env, "JEV_API_BASE_URL", provider);
  }

  return {
    provider,
    model: provider === "local" ? LOCAL_MODEL_ID : (env.JEV_MODEL ?? "jev-1.13"),
    timeoutMs: positiveInteger(env, "JEV_REQUEST_TIMEOUT_MS", 60_000, 300_000),
    maxAttempts: positiveInteger(env, "JEV_MAX_ATTEMPTS", 3, 6),
    maxResponseBytes: positiveInteger(env, "JEV_MAX_RESPONSE_BYTES", 1_000_000, 10_000_000),
    ...(env.TYPESAFE_API_KEY ? { typesafeApiKey: env.TYPESAFE_API_KEY } : {}),
    ...(env.TYPESAFE_BASE_URL ? { typesafeBaseUrl: env.TYPESAFE_BASE_URL } : {}),
    ...(env.OPENROUTER_API_KEY ? { openRouterApiKey: env.OPENROUTER_API_KEY } : {}),
    openRouterBaseUrl: env.JEV_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api",
    ...(env.JEV_API_KEY ? { compatibleApiKey: env.JEV_API_KEY } : {}),
    ...(env.JEV_API_BASE_URL ? { compatibleBaseUrl: env.JEV_API_BASE_URL } : {}),
    localModelRepo: env.JEV_LOCAL_MODEL_REPO ?? LOCAL_MODEL_REPO,
    localDtype: localDtype(env),
  };
}
