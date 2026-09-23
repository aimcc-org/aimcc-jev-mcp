import { z } from "zod";

const identifier = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/);

export const screenContentInputSchema = z
  .object({
    content: z.string().min(1).max(100_000),
    rules: z
      .array(
        z
          .object({
            id: identifier,
            description: z.string().min(1).max(4_000),
            action: z.enum(["review", "block"]),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.rules.forEach((rule, index) => {
      if (ids.has(rule.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "id"],
          message: `Rule ID 重复：${rule.id}`,
        });
      }
      ids.add(rule.id);
    });
  });

export type ScreenContentInput = z.infer<typeof screenContentInputSchema>;
