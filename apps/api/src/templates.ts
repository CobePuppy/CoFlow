import { z } from 'zod';
export const templateContentSchema = z
  .object({
    title: z.string().max(200).default(''),
    background: z.string().max(10000).default(''),
    goal: z.string().max(10000).default(''),
    description: z.string().max(100000).default(''),
    criteria: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
  })
  .strict();
export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  content: templateContentSchema,
  active: z.boolean().default(true),
});
