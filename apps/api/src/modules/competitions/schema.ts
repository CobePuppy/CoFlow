import { z } from 'zod';
export const competitionInput = z.object({
  name: z.string().trim().min(1).max(200),
  organizer: z.string().trim().max(200).default(''),
  url: z
    .union([
      z.literal(''),
      z
        .url()
        .refine(
          (value) => ['http:', 'https:'].includes(new URL(value).protocol),
          '仅支持HTTP或HTTPS网址',
        ),
    ])
    .default(''),
  deadline: z.union([z.literal(''), z.iso.date()]).default(''),
  stage: z
    .enum(['PREPARING', 'REGISTERED', 'SUBMITTED', 'FINISHED'])
    .default('PREPARING'),
  outcome: z.string().max(2000).default(''),
  notes: z.string().max(20000).default(''),
});
