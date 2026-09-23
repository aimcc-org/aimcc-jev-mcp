import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, "ID 仅允许字母、数字、下划线、短横线和点号");

const uniqueIds = (
  values: Array<{ id: string }>,
  context: z.RefinementCtx,
  path: string,
): void => {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path, index, "id"],
        message: `ID 重复：${value.id}`,
      });
    }
    ids.add(value.id);
  });
};

export const completionGateInputSchema = z
  .object({
    requirements: z
      .array(
        z
          .object({
            id: identifier,
            text: z.string().min(1).max(4_000),
            blocking: z.boolean().optional().default(true),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    evidence: z
      .array(
        z
          .object({
            id: identifier,
            type: z.enum([
              "text",
              "diff",
              "test",
              "lint",
              "typecheck",
              "build",
              "file",
              "log",
              "screenshot",
              "other",
            ]),
            text: z.string().min(1).max(200_000),
            provenance: z
              .object({
                path: z.string().optional(),
                command: z.string().optional(),
                uri: z.string().optional(),
                generatedBy: z
                  .enum(["client", "tool", "user", "unknown"])
                  .optional(),
              })
              .strict()
              .optional(),
            hash: z.string().optional(),
            timestamp: z.string().datetime().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    checks: z
      .array(
        z
          .object({
            id: identifier,
            description: z.string().min(1).max(1_000).optional(),
            status: z.enum(["passed", "failed", "not_run"]),
            blocking: z.boolean().optional().default(true),
            output: z.string().max(20_000).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional()
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    uniqueIds(value.requirements, context, "requirements");
    uniqueIds(value.evidence, context, "evidence");
    uniqueIds(value.checks, context, "checks");
  });

export type CompletionGateInput = z.infer<typeof completionGateInputSchema>;
