import { readFileSync } from "node:fs";
import { z } from "zod";
import { KernelError } from "../core/errors.js";

const policyConfigSchema = z
  .object({
    version: z.string().min(1),
    verify: z
      .object({
        minimumConfidence: z.number().min(0).max(1),
        profile: z.string().min(1),
      })
      .strict(),
    rankCandidates: z
      .object({
        minimumConfidence: z.number().min(0).max(1),
        minimumMargin: z.number().min(0).max(1),
        profile: z.string().min(1),
      })
      .strict(),
    selectCapability: z
      .object({
        minimumRelevance: z.number().min(0).max(1),
        minimumConfidence: z.number().min(0).max(1),
        minimumMargin: z.number().min(0).max(1),
        profile: z.string().min(1),
      })
      .strict(),
    assessTask: z
      .object({
        minimumConfidence: z.number().min(0).max(1),
        maximumAutoComplexity: z.number().min(0).max(3),
        maximumAutoRisk: z.number().min(0).max(3),
        maximumAutoAmbiguity: z.number().min(0).max(3),
        profile: z.string().min(1),
      })
      .strict(),
    screenContent: z
      .object({
        reviewProbability: z.number().min(0).max(1),
        blockProbability: z.number().min(0).max(1),
        profile: z.string().min(1),
      })
      .strict()
      .refine((value) => value.blockProbability >= value.reviewProbability, {
        message: "blockProbability 必须大于等于 reviewProbability。",
      }),
    completionGate: z
      .object({
        minimumConfidence: z.number().min(0).max(1),
        profile: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export function loadPolicyConfig(): PolicyConfig {
  const url = new URL("../../config/policies.json", import.meta.url);
  try {
    return policyConfigSchema.parse(JSON.parse(readFileSync(url, "utf8")) as unknown);
  } catch (error) {
    throw new KernelError(
      "CONFIGURATION_ERROR",
      `策略配置读取失败：${url.pathname}`,
      error,
    );
  }
}
