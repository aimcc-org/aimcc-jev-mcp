import { z } from "zod";

export const assessTaskInputSchema = z
  .object({
    task: z.string().min(1).max(12_000),
    context: z.string().max(24_000).optional(),
    constraints: z.array(z.string().min(1).max(2_000)).max(32).optional().default([]),
  })
  .strict();

export type AssessTaskInput = z.infer<typeof assessTaskInputSchema>;
