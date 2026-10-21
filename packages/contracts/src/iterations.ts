import { z } from 'zod';
export const iterationInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().min(1).max(10000),
    ownerId: z.string().uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    changeReason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, {
    message: '结束日期不能早于开始日期',
    path: ['endDate'],
  });
export const milestoneInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(3000).default(''),
    dueDate: z.iso.date(),
  })
  .strict();
export function iterationProgress(c: {
  planned: number;
  accepted: number;
  cancelled: number;
  deleted: number;
  overdue: number;
  blocked: number;
}) {
  return {
    planned: c.planned,
    accepted: c.accepted,
    cancelled: c.cancelled,
    deleted: c.deleted,
    overdue: c.overdue,
    blocked: c.blocked,
    unfinished: c.planned - c.accepted,
    percent: c.planned ? Math.floor((c.accepted / c.planned) * 100) : 0,
  };
}
export type IterationProgress = ReturnType<typeof iterationProgress>;
export type IterationSummary = {
  id: string;
  name: string;
  goal: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  version: number;
  canManage: boolean;
  readOnly: boolean;
  progress: IterationProgress;
};
export type IterationMilestone = {
  id: string;
  name: string;
  goal: string;
  dueDate: string;
  progress: IterationProgress;
};
export type IterationDetail = IterationSummary & {
  milestones: IterationMilestone[];
  unassigned: IterationProgress;
  events: {
    id: string;
    action: string;
    actorId: string;
    data: Record<string, unknown>;
    createdAt: string;
  }[];
};
export type IterationTask = {
  id: string;
  taskId: string;
  number: number;
  title: string;
  status: string;
  workflow: string;
  taskDueDate: string | null;
  dueDate: string;
  milestoneId: string | null;
  delayNote: string;
  deletedAt: string | null;
  overdue: boolean;
  handlerIds: string[];
  blockReasons: string[];
};
