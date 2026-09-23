import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, "ID 仅允许字母、数字、下划线、短横线和点号");

const provenanceSchema = z
  .object({
    path: z.string().optional(),
    command: z.string().optional(),
    uri: z.string().optional(),
    generatedBy: z.enum(["client", "tool", "user", "unknown"]).optional(),
  })
  .strict();

export const verifyInputSchema = z
  .object({
    claims: z
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
            provenance: provenanceSchema.optional(),
            hash: z.string().optional(),
            timestamp: z.string().datetime().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((value, context) => {
    const claimIds = new Set<string>();
    value.claims.forEach((claim, index) => {
      if (claimIds.has(claim.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claims", index, "id"],
          message: `Claim ID 重复：${claim.id}`,
        });
      }
      claimIds.add(claim.id);
    });
    const evidenceIds = new Set<string>();
    value.evidence.forEach((evidence, index) => {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index, "id"],
          message: `Evidence ID 重复：${evidence.id}`,
        });
      }
      evidenceIds.add(evidence.id);
    });
  });

export type VerifyInput = z.infer<typeof verifyInputSchema>;
