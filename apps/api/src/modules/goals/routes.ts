import type { Router } from 'express';
import { z } from 'zod';
import {
  goalFields,
  goalChange,
  goalTaskIds,
  goalProgress,
  commandQueues,
} from '@coflow/contracts/project-goals.js';
import { getHandlerIds, type Task } from '@coflow/contracts/index.js';
import {
  db,
  hash,
  project,
  projectWrite,
  record,
  wrap,
} from '../../shared/access.js';
import { assert } from '../requirements/domain.js';
import { planningContext } from './context.js';

async function manager(tx: any, r: any, p: any, goal?: any) {
  const m = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId: p.id, userId: r.user.id } },
  });
  const team = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
    },
  });
  return (
    !!m &&
    !!team &&
    (team.role === 'ADMIN' ||
      m.roles.includes('PRODUCT') ||
      goal?.ownerId === r.user.id)
  );
}
async function owner(tx: any, p: any, ownerId: string) {
  assert(
    (await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: ownerId } },
    })) &&
      (await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: p.workspaceId, userId: ownerId },
        },
      })),
    '目标负责人必须是当前项目成员',
    422,
  );
}
async function once(
  tx: any,
  r: any,
  key: string,
  input: any,
  run: () => Promise<any>,
) {
  const digest = hash(JSON.stringify(input));
  const old = await tx.idempotencyRecord.findUnique({
    where: { userId_key: { userId: r.user.id, key } },
  });
  if (old) {
    assert(old.digest === digest, '请求标识已使用，请核对后重试', 409);
    return old.result;
  }
  const result = await run();
  await tx.idempotencyRecord.create({
    data: {
      userId: r.user.id,
      key,
      digest,
      result: JSON.parse(JSON.stringify(result)),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return result;
}
export function installGoalRoutes(router: Router) {
  router.get(
    '/projects/:id/goals',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      const scope = z.string().min(1).max(100).optional().parse(r.query.goalId);
      const result = await db.$transaction(
        async (tx) => {
          const plan = await planningContext(tx, p.id);
          const tasks = await tx.task.findMany({
            where: { projectId: p.id },
            orderBy: { id: 'asc' },
            take: 501,
          });
          assert(
            tasks.length <= 500,
            '目标工作台暂支持最多500项需求（含回收站及终止记录）',
            422,
          );
          const people = await tx.projectMember.findMany({
            where: { projectId: p.id },
          });
          const team = await tx.workspaceMember.findMany({
            where: {
              workspaceId: p.workspaceId,
              userId: { in: people.map((m) => m.userId) },
            },
          });
          const users = await tx.user.findMany({
            where: { id: { in: team.map((m) => m.userId) } },
            select: { id: true, name: true },
          });
          const canCreate = await manager(tx, r, p);
          const covered = new Set(
            plan.goals
              .filter((g) => g.status === 'ACTIVE')
              .flatMap((g) => goalTaskIds(plan, g.id)),
          );
          const uncovered = tasks
            .filter((t) => !covered.has(t.id))
            .map((t) => t.id);
          assert(
            !scope ||
              scope === 'unlinked' ||
              plan.goals.some((g) => g.id === scope),
            '目标不存在或不属于当前项目',
            404,
          );
          const ids = new Set(
            scope === 'unlinked'
              ? uncovered
              : scope
                ? goalTaskIds(plan, scope)
                : tasks.map((t) => t.id),
          );
          return {
            canCreate: canCreate && !p.archivedAt,
            readOnly: !!p.archivedAt,
            members: users,
            goals: plan.goals.map((g) => ({
              ...g,
              directTaskIds: plan.goalTasks
                .filter((x) => x.goalId === g.id)
                .map((x) => x.taskId),
              iterationIds: plan.goalIterations
                .filter((x) => x.goalId === g.id)
                .map((x) => x.iterationId),
              taskIds: goalTaskIds(plan, g.id),
              progress: goalProgress(
                tasks as unknown as Task[],
                goalTaskIds(plan, g.id),
              ),
              canManage:
                !p.archivedAt && (canCreate || g.ownerId === r.user.id),
            })),
            iterations: plan.iterations.map((i) => ({
              ...i,
              taskIds: plan.iterationTasks
                .filter((x) => x.iterationId === i.id)
                .map((x) => x.taskId),
              milestones: plan.milestones
                .filter((m) => m.iterationId === i.id)
                .map((m) => ({
                  ...m,
                  taskIds: plan.iterationTasks
                    .filter((x) => x.milestoneId === m.id)
                    .map((x) => x.taskId),
                })),
              unassignedTaskIds: plan.iterationTasks
                .filter((x) => x.iterationId === i.id && !x.milestoneId)
                .map((x) => x.taskId),
            })),
            tasks: tasks.map((t) => {
              const d = t.data as any;
              return {
                id: t.id,
                number: t.number,
                title: d.title,
                status: t.status,
                version: t.version,
                deleted: !!t.deletedAt,
                workflow: d.workflow,
                dueAt: d.dueAt,
                handlerIds: getHandlerIds(t as unknown as Task).filter(Boolean),
                blocked: d.blocks.some((b: any) => !b.end),
              };
            }),
            actions: plan.actions,
            uncoveredTaskIds: uncovered,
            queues: commandQueues(
              tasks.filter((t) => ids.has(t.id)) as unknown as Task[],
              plan.actions.filter((a) => ids.has(a.taskId)),
              r.user.id,
              canCreate,
            ),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
    }),
  );
  router.get(
    '/projects/:id/goals/:goalId',
    wrap(async (r, s) => {
      await project(r, String(r.params.id));
      const g = await db.projectGoal.findFirst({
        where: { id: String(r.params.goalId), projectId: String(r.params.id) },
      });
      assert(g, '目标不存在', 404);
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(g);
    }),
  );
  router.post(
    '/projects/:id/goals',
    wrap(async (r, s) => {
      const input = goalFields.extend({ requestKey: z.uuid() }).parse(r.body);
      const result = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, String(r.params.id));
        assert(
          await manager(tx, r, p),
          '仅产品成员或团队管理员可创建目标',
          403,
        );
        return once(
          tx,
          r,
          'goal-create:' + p.id + ':' + input.requestKey,
          input,
          async () => {
            await owner(tx, p, input.ownerId);
            assert(
              (await tx.projectGoal.count({ where: { projectId: p.id } })) <
                100,
              '单项目最多100项目标',
              422,
            );
            const { requestKey, ...fields } = input;
            const g = await tx.projectGoal.create({
              data: {
                ...fields,
                projectId: p.id,
                workspaceId: p.workspaceId,
                createdBy: r.user.id,
                events: [
                  {
                    operation: 'CREATE',
                    by: r.user.id,
                    at: new Date().toISOString(),
                    fields,
                  },
                ],
              },
            });
            await record(tx, r, p.workspaceId, g.id, 'PROJECT_GOAL_CREATE');
            return g;
          },
        );
      });
      s.json(result);
    }),
  );
  router.post(
    '/projects/:id/goals/:goalId/change',
    wrap(async (r, s) => {
      const input = goalChange.parse(r.body);
      const result = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, String(r.params.id));
        const g = await tx.projectGoal.findFirst({
          where: { id: String(r.params.goalId), projectId: p.id },
        });
        assert(g, '目标不存在', 404);
        assert(
          await manager(tx, r, p, g),
          '仅目标负责人、产品成员或管理员可维护目标',
          403,
        );
        return once(
          tx,
          r,
          'goal-change:' + g.id + ':' + input.requestKey,
          input,
          async () => {
            assert(
              g.version === input.expectedVersion,
              '目标已变化，请保留输入并核对最新版本',
              409,
            );
            assert(
              (g.events as any[]).length < 1000,
              '目标历史已达1000项，请建立后续目标',
              422,
            );
            assert(
              g.status === 'ACTIVE' || input.operation !== 'LINK',
              '目标已归档，请先恢复',
              409,
            );
            const fields: any = {};
            let before: any = null;
            if (input.operation === 'EDIT') {
              await owner(tx, p, input.fields.ownerId);
              Object.assign(fields, input.fields);
              before = {
                title: g.title,
                description: g.description,
                criteria: g.criteria,
                ownerId: g.ownerId,
                dueDate: g.dueDate,
              };
            } else {
              await owner(tx, p, g.ownerId);
              if (input.operation === 'STATUS') {
                assert(g.status !== input.status, '目标状态未变化');
                fields.status = input.status;
                before = { status: g.status };
              } else {
                const taskIds = [...new Set(input.taskIds)],
                  iterationIds = [...new Set(input.iterationIds)];
                const oldTasks = await tx.projectGoalTask.findMany({
                  where: { goalId: g.id },
                });
                const oldIterations = await tx.projectGoalIteration.findMany({
                  where: { goalId: g.id },
                });
                const tasks = await tx.task.findMany({
                  where: { id: { in: taskIds }, projectId: p.id },
                });
                assert(
                  tasks.length === taskIds.length &&
                    tasks.every(
                      (t) =>
                        !t.deletedAt || oldTasks.some((x) => x.taskId === t.id),
                    ),
                  '关联需求须属于当前项目且不在回收站',
                  422,
                );
                assert(
                  (await tx.iteration.count({
                    where: { id: { in: iterationIds }, projectId: p.id },
                  })) === iterationIds.length,
                  '关联迭代须属于当前项目',
                  422,
                );
                before = {
                  taskIds: oldTasks.map((x) => x.taskId),
                  iterationIds: oldIterations.map((x) => x.iterationId),
                };
                await tx.projectGoalTask.deleteMany({
                  where: { goalId: g.id },
                });
                await tx.projectGoalIteration.deleteMany({
                  where: { goalId: g.id },
                });
                if (taskIds.length)
                  await tx.projectGoalTask.createMany({
                    data: taskIds.map((taskId) => ({ goalId: g.id, taskId })),
                  });
                if (iterationIds.length)
                  await tx.projectGoalIteration.createMany({
                    data: iterationIds.map((iterationId) => ({
                      goalId: g.id,
                      iterationId,
                    })),
                  });
              }
            }
            const event = {
              ...input,
              by: r.user.id,
              at: new Date().toISOString(),
              before,
            };
            const changed = await tx.projectGoal.updateMany({
              where: { id: g.id, version: g.version },
              data: {
                ...fields,
                version: { increment: 1 },
                events: [...(g.events as any[]), event],
              },
            });
            assert(changed.count, '目标已变化，请刷新后重试', 409);
            await record(
              tx,
              r,
              p.workspaceId,
              g.id,
              'PROJECT_GOAL_' + input.operation,
            );
            return tx.projectGoal.findUniqueOrThrow({ where: { id: g.id } });
          },
        );
      });
      s.json(result);
    }),
  );
}
