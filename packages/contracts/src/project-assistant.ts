import { z } from 'zod';

export const projectPlanSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    actions: z
      .array(
        z
          .object({
            taskId: z.string().min(1).max(100),
            priority: z.enum(['HIGH', 'NORMAL']),
            action: z.string().min(1).max(1000),
            acceptance: z.string().min(1).max(1000),
            evidence: z.string().min(2).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    questions: z.array(z.string().min(1).max(500)).max(8),
  })
  .strict();
export type ProjectPlan = z.infer<typeof projectPlanSchema>;
