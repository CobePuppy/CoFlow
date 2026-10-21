import { z } from 'zod';
import { statuses } from '@coflow/contracts/index.js';

export const savedFiltersSchema = z
  .object({
    scope: z
      .enum(['active', 'all', 'mine', 'handling', 'overdue', 'ended', 'trash'])
      .optional(),
    q: z.string().trim().max(200).optional(),
    status: z.enum(statuses).optional(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
    owner: z.string().min(1).max(100).optional(),
    blocked: z.enum(['true', 'false']).optional(),
    sort: z.enum(['updated', 'due', 'priority']).optional(),
  })
  .strict();
export const savedViewSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    view: z.enum(['tasks', 'todos']),
    mode: z.enum(['list', 'board']),
    projectId: z.string().uuid().nullable(),
    filters: savedFiltersSchema,
  })
  .strict()
  .refine((v) => (v.view === 'tasks' ? !!v.projectId : v.projectId === null), {
    message: '项目视图须指定项目，团队待办不绑定项目',
    path: ['projectId'],
  });
export type SavedViewContent = z.infer<typeof savedViewSchema>;
export type SavedView = SavedViewContent & {
  id: string;
  workspaceId: string;
  version: number;
};
export const notificationReadSchema = z.union([
  z.object({ workspaceId: z.string().uuid(), all: z.literal(true) }).strict(),
  z
    .object({
      workspaceId: z.string().uuid(),
      ids: z.array(z.string().uuid()).min(1).max(100),
    })
    .strict(),
]);
