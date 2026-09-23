import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, "ID 仅允许字母、数字、下划线、短横线和点号");

export const rankCandidatesInputSchema = z
  .object({
    objective: z.string().min(1).max(8_000),
    candidates: z
      .array(
        z
          .object({
            id: identifier,
            description: z.string().min(1).max(4_000),
          })
          .strict(),
      )
      .min(2)
      .max(32),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates", index, "id"],
          message: `Candidate ID 重复：${candidate.id}`,
        });
      }
      ids.add(candidate.id);
    });
  });

export type RankCandidatesInput = z.infer<typeof rankCandidatesInputSchema>;
