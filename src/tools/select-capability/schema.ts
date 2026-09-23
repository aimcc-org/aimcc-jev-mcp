import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/);

export const selectCapabilityInputSchema = z
  .object({
    task: z.string().min(1).max(8_000),
    capabilities: z
      .array(
        z
          .object({
            id: identifier,
            description: z.string().min(1).max(4_000),
            available: z.boolean().optional().default(true),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.capabilities.forEach((capability, index) => {
      if (ids.has(capability.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities", index, "id"],
          message: `Capability ID 重复：${capability.id}`,
        });
      }
      ids.add(capability.id);
    });
  });

export type SelectCapabilityInput = z.infer<typeof selectCapabilityInputSchema>;
