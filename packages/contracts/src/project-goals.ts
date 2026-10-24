import { z } from 'zod';
import { getHandlerIds, terminal, type Task } from './index.js';
import { isOverdue } from './deadline.js';

export const goalFields = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4000),
    criteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
    ownerId: z.string().min(1).max(100),
    dueDate: z.iso.date().nullable(),
  })
  .strict();
const change = z.object({
  expectedVersion: z.number().int().positive(),
  requestKey: z.uuid(),
  note: z.string().trim().min(1).max(2000),
});
export const goalChange = z.discriminatedUnion('operation', [
  change.extend({ operation: z.literal('EDIT'), fields: goalFields }).strict(),
  change
    .extend({
      operation: z.literal('LINK'),
      taskIds: z.array(z.string().min(1).max(100)).max(200),
      iterationIds: z.array(z.string().min(1).max(100)).max(20),
    })
    .strict(),
  change
    .extend({
      operation: z.literal('STATUS'),
      status: z.enum(['ACTIVE', 'ARCHIVED']),
    })
    .strict(),
]);
export type PlanningContext = {
  goals: {
    id: string;
    title: string;
    description: string;
    criteria: string[];
    ownerId: string;
    dueDate: string | null;
    status: string;
    version: number;
  }[];
  goalTasks: { goalId: string; taskId: string }[];
  goalIterations: { goalId: string; iterationId: string }[];
  iterations: {
    id: string;
    name: string;
    goal: string;
    ownerId: string;
    startDate: string;
    endDate: string;
    version: number;
  }[];
  milestones: {
    id: string;
    iterationId: string;
    name: string;
    goal: string;
    dueDate: string;
  }[];
  iterationTasks: {
    iterationId: string;
    taskId: string;
    milestoneId: string | null;
    delayNote: string;
  }[];
  actions: {
    id: string;
    taskId: string;
    title: string;
    acceptance: string;
    status: string;
    ownerId: string | null;
    dueDate: string | null;
    version: number;
    outcome: string;
  }[];
};
export function goalTaskIds(context: PlanningContext, goalId: string) {
  const iterations = new Set(
    context.goalIterations
      .filter((x) => x.goalId === goalId)
      .map((x) => x.iterationId),
  );
  return [
    ...new Set([
      ...context.goalTasks
        .filter((x) => x.goalId === goalId)
        .map((x) => x.taskId),
      ...context.iterationTasks
        .filter((x) => iterations.has(x.iterationId))
        .map((x) => x.taskId),
    ]),
  ];
}
export function goalProgress(
  tasks: Pick<Task, 'id' | 'status' | 'deletedAt'>[],
  ids: string[],
) {
  const unique = new Set(ids);
  const rows = tasks.filter((t) => unique.has(t.id));
  const planned = rows.filter((t) => !t.deletedAt && t.status !== 'CANCELLED');
  const accepted = planned.filter((t) => t.status === 'CLOSED').length;
  return {
    planned: planned.length,
    accepted,
    cancelled: rows.filter((t) => !t.deletedAt && t.status === 'CANCELLED')
      .length,
    deleted: rows.filter((t) => !!t.deletedAt).length,
    percent: planned.length ? Math.floor((accepted / planned.length) * 100) : 0,
  };
}
export function commandQueues(
  tasks: Task[],
  actions: PlanningContext['actions'],
  userId: string,
  manager: boolean,
  now = Date.now(),
) {
  const active = tasks.filter((t) => !t.deletedAt && !terminal(t.status));
  const available = new Set(tasks.filter((t) => !t.deletedAt).map((t) => t.id));
  const owned = actions.filter(
    (a) =>
      available.has(a.taskId) && a.ownerId === userId && a.status === 'DOING',
  );
  const review = actions.filter(
    (a) =>
      available.has(a.taskId) &&
      a.status === 'SUBMITTED' &&
      a.ownerId !== userId &&
      (manager ||
        tasks.find((t) => t.id === a.taskId)?.data.productId === userId),
  );
  return {
    myTasks: active
      .filter((t) => getHandlerIds(t).includes(userId))
      .map((t) => t.id),
    myActions: owned.map((a) => a.id),
    reviews: review.map((a) => a.id),
    blocked: active
      .filter((t) => t.data.blocks.some((b) => !b.end))
      .map((t) => t.id),
    overdueTasks: active
      .filter((t) => isOverdue(t.data.dueAt, now))
      .map((t) => t.id),
    overdueActions: actions
      .filter(
        (a) =>
          available.has(a.taskId) &&
          a.status !== 'DONE' &&
          isOverdue(a.dueDate || undefined, now),
      )
      .map((a) => a.id),
    waiting: active
      .filter((t) => {
        const ids = getHandlerIds(t).filter(Boolean);
        return ids.length > 0 && !ids.includes(userId);
      })
      .map((t) => t.id),
    unclaimed: actions
      .filter((a) => available.has(a.taskId) && a.status === 'OPEN')
      .map((a) => a.id),
  };
}
