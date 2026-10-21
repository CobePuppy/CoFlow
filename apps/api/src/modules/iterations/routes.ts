import type { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  iterationInput,
  milestoneInput,
  iterationProgress,
} from '@coflow/contracts/iterations.js';
import { requirementNumber } from '@coflow/contracts/requirement-list.js';
import {
  db,
  page,
  project,
  projectWrite,
  record,
  task,
  wrap,
} from '../../shared/access.js';
import { assert, handlers } from '../requirements/domain.js';
const expected = z.number().int().positive();
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const active = Prisma.sql`t."deletedAt" IS NULL AND t.status<>'CANCELLED'`;
const deadline = Prisma.sql`LEAST(COALESCE(NULLIF(LEFT(t.data->>'dueAt',10),''),COALESCE(m."dueDate",i."endDate")),COALESCE(m."dueDate",i."endDate"))`;
const late = () =>
  Prisma.sql`${active} AND t.status<>'CLOSED' AND ${deadline}<${today()}`;
const blocking = Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.data->'blocks','[]'::jsonb)) b WHERE COALESCE(b->>'end','')='')`;
const counts = () =>
  Prisma.sql`count(*) FILTER(WHERE ${active})::int AS planned,count(*) FILTER(WHERE ${active} AND t.status='CLOSED')::int AS accepted,count(*) FILTER(WHERE t."deletedAt" IS NULL AND t.status='CANCELLED')::int AS cancelled,count(*) FILTER(WHERE t."deletedAt" IS NOT NULL)::int AS deleted,count(*) FILTER(WHERE ${late()})::int AS overdue,count(*) FILTER(WHERE ${active} AND t.status<>'CLOSED' AND ${blocking})::int AS blocked`;
const empty = () =>
  iterationProgress({
    planned: 0,
    accepted: 0,
    cancelled: 0,
    deleted: 0,
    overdue: 0,
    blocked: 0,
  });
async function permissions(tx: any, r: any, p: any, iteration?: any) {
  const [member, team] = await Promise.all([
    tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: r.user.id } },
    }),
    tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
      },
    }),
  ]);
  return (
    !!member &&
    !!team &&
    (team.role === 'ADMIN' ||
      member.roles.includes('PRODUCT') ||
      iteration?.ownerId === r.user.id)
  );
}
async function owner(tx: any, p: any, id: string) {
  assert(
    (await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: id } },
    })) &&
      (await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: p.workspaceId, userId: id },
        },
      })),
    '迭代负责人须为当前项目成员',
    422,
  );
}
async function write(
  tx: any,
  r: any,
  pid: string,
  iid: string,
  version: number,
) {
  const p = await projectWrite(tx, r, pid);
  const i = await tx.iteration.findUnique({ where: { id: iid } });
  assert(i && i.projectId === pid, '迭代不存在', 404);
  assert(
    await permissions(tx, r, p, i),
    '仅迭代负责人、产品成员或团队管理员可维护计划',
    403,
  );
  assert(
    (
      await tx.iteration.updateMany({
        where: { id: iid, version },
        data: { version: { increment: 1 } },
      })
    ).count,
    '迭代已更新，请保留输入并核对最新计划',
    409,
  );
  return i;
}
async function event(tx: any, r: any, i: any, action: string, data: any) {
  await tx.iterationEvent.create({
    data: { iterationId: i.id, actorId: r.user.id, action, data },
  });
  await record(tx, r, i.workspaceId, i.id, 'ITERATION_' + action);
}
async function milestone(tx: any, i: any, id: string | null) {
  if (!id) return;
  assert(
    await tx.iterationMilestone.findFirst({ where: { id, iterationId: i.id } }),
    '里程碑不属于当前迭代',
    422,
  );
}
const criteriaQuery = (q: string) => {
  const n = requirementNumber(q);
  return !q
    ? Prisma.sql`TRUE`
    : n !== null
      ? Prisma.sql`t.number=${n}`
      : Prisma.sql`strpos(lower(COALESCE(t.data->>'title','')),lower(${q}))>0`;
};
export function installIterationRoutes(router: Router) {
  router.use(
    ['/projects/:id/iterations', '/tasks/:id/iteration'],
    (_r, s, next) => {
      s.setHeader('Cache-Control', 'private, no-store');
      next();
    },
  );
  router.get(
    '/projects/:id/iterations',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id)),
        pg = page(r);
      const result = await db.$transaction(
        async (tx) => {
          const total = await tx.iteration.count({
            where: { projectId: p.id },
          });
          const rows = await tx.iteration.findMany({
            where: { projectId: p.id },
            orderBy: [{ endDate: 'desc' }, { id: 'asc' }],
            take: pg.pageSize,
            skip: (pg.page - 1) * pg.pageSize,
          });
          const metrics = rows.length
            ? await tx.$queryRaw<any[]>(
                Prisma.sql`SELECT i.id,${counts()} FROM "Iteration" i JOIN "IterationTask" x ON x."iterationId"=i.id JOIN "Task" t ON t.id=x."taskId" LEFT JOIN "IterationMilestone" m ON m.id=x."milestoneId" WHERE i.id IN (${Prisma.join(rows.map((x) => x.id))}) GROUP BY i.id`,
              )
            : [];
          const canCreate = await permissions(tx, r, p);
          return {
            ...pg,
            total,
            canCreate: canCreate && !p.archivedAt,
            readOnly: !!p.archivedAt,
            items: await Promise.all(
              rows.map(async (i) => ({
                ...i,
                canManage: !p.archivedAt && (await permissions(tx, r, p, i)),
                readOnly: !!p.archivedAt,
                progress: metrics.find((m) => m.id === i.id)
                  ? iterationProgress(metrics.find((m) => m.id === i.id))
                  : empty(),
              })),
            ),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.post(
    '/projects/:id/iterations',
    wrap(async (r, s) => {
      const pid = String(r.params.id),
        input = iterationInput.parse(r.body);
      const item = await db.$transaction(async (tx) => {
        const p = await projectWrite(tx, r, pid);
        assert(
          await permissions(tx, r, p),
          '仅产品成员或团队管理员可创建迭代',
          403,
        );
        await owner(tx, p, input.ownerId);
        const { changeReason, ...data } = input;
        const i = await tx.iteration.create({
          data: {
            ...data,
            projectId: pid,
            workspaceId: p.workspaceId,
            createdBy: r.user.id,
          },
        });
        await event(tx, r, i, 'CREATE', {
          name: i.name,
          startDate: i.startDate,
          endDate: i.endDate,
        });
        return i;
      });
      s.status(201).json(item);
    }),
  );
  router.get(
    '/projects/:id/iterations/:iterationId',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      const result = await db.$transaction(
        async (tx) => {
          const i = await tx.iteration.findFirst({
            where: { id: String(r.params.iterationId), projectId: p.id },
          });
          assert(i, '迭代不存在', 404);
          const ms = await tx.iterationMilestone.findMany({
            where: { iterationId: i.id },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          });
          const metrics = await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT x."milestoneId",${counts()} FROM "IterationTask" x JOIN "Task" t ON t.id=x."taskId" JOIN "Iteration" i ON i.id=x."iterationId" LEFT JOIN "IterationMilestone" m ON m.id=x."milestoneId" WHERE i.id=${i.id} GROUP BY x."milestoneId"`,
          );
          const total = {
            planned: 0,
            accepted: 0,
            cancelled: 0,
            deleted: 0,
            overdue: 0,
            blocked: 0,
          };
          for (const m of metrics)
            for (const k of Object.keys(total) as (keyof typeof total)[])
              total[k] += m[k];
          return {
            ...i,
            canManage: !p.archivedAt && (await permissions(tx, r, p, i)),
            readOnly: !!p.archivedAt,
            progress: iterationProgress(total),
            unassigned: metrics.find((m) => !m.milestoneId)
              ? iterationProgress(metrics.find((m) => !m.milestoneId))
              : empty(),
            milestones: ms.map((m) => ({
              ...m,
              progress: metrics.find((x) => x.milestoneId === m.id)
                ? iterationProgress(metrics.find((x) => x.milestoneId === m.id))
                : empty(),
            })),
            events: await tx.iterationEvent.findMany({
              where: { iterationId: i.id },
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              take: 20,
            }),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.patch(
    '/projects/:id/iterations/:iterationId',
    wrap(async (r, s) => {
      const version = expected.parse(r.body.expectedVersion);
      const { expectedVersion, ...body } = r.body;
      const input = iterationInput.parse(body);
      const result = await db.$transaction(async (tx) => {
        const i = await write(
          tx,
          r,
          String(r.params.id),
          String(r.params.iterationId),
          version,
        );
        await owner(
          tx,
          { id: i.projectId, workspaceId: i.workspaceId },
          input.ownerId,
        );
        const datesChanged =
          i.startDate !== input.startDate || i.endDate !== input.endDate;
        assert(
          !datesChanged || !!input.changeReason,
          '调整迭代日期须填写排期调整原因',
          422,
        );
        assert(
          !(await tx.iterationMilestone.count({
            where: {
              iterationId: i.id,
              OR: [
                { dueDate: { lt: input.startDate } },
                { dueDate: { gt: input.endDate } },
              ],
            },
          })),
          '新日期范围须覆盖已有里程碑，请先调整里程碑',
          422,
        );
        const { changeReason, ...data } = input;
        const changed = await tx.iteration.update({
          where: { id: i.id },
          data,
        });
        await event(tx, r, i, 'UPDATE', {
          name: input.name,
          previousOwnerId: i.ownerId,
          ownerId: input.ownerId,
          previousGoal: i.goal,
          goal: input.goal,
          ...(datesChanged
            ? {
                before: { startDate: i.startDate, endDate: i.endDate },
                after: { startDate: input.startDate, endDate: input.endDate },
                reason: input.changeReason,
              }
            : {}),
        });
        return changed;
      });
      s.json(result);
    }),
  );
  router.get(
    '/projects/:id/iterations/:iterationId/tasks',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id)),
        pg = page(r),
        iid = String(r.params.iterationId);
      const filter = z
        .enum(['all', 'unfinished', 'overdue'])
        .parse(r.query.filter || 'all');
      const q = z
        .string()
        .trim()
        .max(200)
        .parse(r.query.q || '');
      const result = await db.$transaction(
        async (tx) => {
          assert(
            await tx.iteration.findFirst({
              where: { id: iid, projectId: p.id },
            }),
            '迭代不存在',
            404,
          );
          const condition = Prisma.sql`i.id=${iid} AND ${criteriaQuery(q)} AND ${filter === 'overdue' ? late() : filter === 'unfinished' ? Prisma.sql`${active} AND t.status<>'CLOSED'` : Prisma.sql`TRUE`}`;
          const from = Prisma.sql`FROM "IterationTask" x JOIN "Iteration" i ON i.id=x."iterationId" JOIN "Task" t ON t.id=x."taskId" LEFT JOIN "IterationMilestone" m ON m.id=x."milestoneId" WHERE ${condition}`;
          const count = await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT count(*)::int AS total ${from}`,
          );
          const rows = await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT x.*,t.number,t.status,t."deletedAt",t.data->>'title' AS title,t.data->>'workflow' AS workflow,t.data->>'dueAt' AS "taskDueDate",${deadline} AS "dueDate",CASE WHEN ${late()} THEN true ELSE false END AS overdue, t.data->'blocks' AS blocks,t.data->>'productId' AS product,t.data->>'engineerId' AS engineer,t.data->>'testerId' AS tester,t.data->>'productReviewerId' AS "productReviewer",t.data->>'qaReviewerId' AS "qaReviewer",t.data->'reviews' AS reviews,jsonb_array_length(COALESCE(t.data->'solutions','[]'::jsonb)) AS "solutionCount" ${from} ORDER BY CASE WHEN ${late()} THEN 0 ELSE 1 END,${deadline},t.number,x.id OFFSET ${(pg.page - 1) * pg.pageSize} LIMIT ${pg.pageSize}`,
          );
          return {
            ...pg,
            total: count[0].total,
            items: rows.map((x) => {
              const mock: any = {
                status: x.status,
                deletedAt: x.deletedAt,
                data: {
                  productId: x.product,
                  engineerId: x.engineer,
                  testerId: x.tester,
                  productReviewerId: x.productReviewer,
                  qaReviewerId: x.qaReviewer,
                  reviews: x.reviews || [],
                  solutions: { length: x.solutionCount },
                },
              };
              return {
                id: x.id,
                taskId: x.taskId,
                milestoneId: x.milestoneId,
                delayNote: x.delayNote,
                number: x.number,
                title: x.title,
                status: x.status,
                workflow: x.workflow,
                taskDueDate: x.taskDueDate,
                dueDate: x.dueDate,
                deletedAt: x.deletedAt,
                overdue: x.overdue,
                handlerIds: handlers(mock),
                blockReasons: (x.blocks || [])
                  .filter((b: any) => !b.end)
                  .map((b: any) => b.reason),
              };
            }),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.get(
    '/projects/:id/iterations/:iterationId/candidates',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id)),
        pg = page(r),
        iid = String(r.params.iterationId),
        q = z
          .string()
          .trim()
          .max(200)
          .parse(r.query.q || '');
      const result = await db.$transaction(
        async (tx) => {
          assert(
            await tx.iteration.findFirst({
              where: { id: iid, projectId: p.id },
            }),
            '迭代不存在',
            404,
          );
          const from = Prisma.sql`FROM "Task" t LEFT JOIN "IterationTask" x ON x."taskId"=t.id LEFT JOIN "Iteration" i ON i.id=x."iterationId" WHERE t."projectId"=${p.id} AND t."deletedAt" IS NULL AND t.status<>'CANCELLED' AND ${criteriaQuery(q)}`;
          const count = await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT count(*)::int AS total ${from}`,
          );
          const items = await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT t.id,t.number,t.status,t.data->>'title' AS title,t.data->>'workflow' AS workflow,i.name AS "iterationName",i.id AS "iterationId" ${from} ORDER BY t."updatedAt" DESC,t.id OFFSET ${(pg.page - 1) * pg.pageSize} LIMIT ${pg.pageSize}`,
          );
          return { ...pg, total: count[0].total, items };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.post(
    '/projects/:id/iterations/:iterationId/tasks',
    wrap(async (r, s) => {
      const input = z
        .object({
          expectedVersion: expected,
          taskIds: z.array(z.string().uuid()).min(1).max(50),
          milestoneId: z.string().uuid().nullable().default(null),
        })
        .strict()
        .parse(r.body);
      assert(
        new Set(input.taskIds).size === input.taskIds.length,
        '需求不能重复选择',
        422,
      );
      await db.$transaction(async (tx) => {
        const i = await write(
          tx,
          r,
          String(r.params.id),
          String(r.params.iterationId),
          input.expectedVersion,
        );
        await milestone(tx, i, input.milestoneId);
        const tasks = await tx.task.findMany({
          where: {
            id: { in: input.taskIds },
            projectId: i.projectId,
            deletedAt: null,
            status: { not: 'CANCELLED' },
          },
          select: { id: true, number: true, data: true },
        });
        assert(
          tasks.length === input.taskIds.length,
          '所选需求不属于当前项目或已不可加入',
          422,
        );
        assert(
          !(await tx.iterationTask.count({
            where: { taskId: { in: input.taskIds } },
          })),
          '所选需求已有迭代安排，请先从原迭代移出',
          409,
        );
        assert(
          (await tx.iterationTask.count({ where: { iterationId: i.id } })) +
            tasks.length <=
            2000,
          '单个迭代最多安排2000项需求',
          422,
        );
        await tx.iterationTask.createMany({
          data: tasks.map((t) => ({
            iterationId: i.id,
            taskId: t.id,
            milestoneId: input.milestoneId,
            createdBy: r.user.id,
          })),
        });
        await event(tx, r, i, 'ADD_TASKS', {
          taskIds: input.taskIds,
          tasks: tasks.map((t) => ({
            taskId: t.id,
            number: t.number,
            title: (t.data as any).title,
          })),
          milestoneId: input.milestoneId,
        });
      });
      s.status(204).end();
    }),
  );
  for (const method of ['patch', 'delete'] as const)
    router[method](
      '/projects/:id/iterations/:iterationId/tasks/:taskId',
      wrap(async (r, s) => {
        const input = z
          .object({
            expectedVersion: expected,
            ...(method === 'patch'
              ? {
                  milestoneId: z.string().uuid().nullable(),
                  delayNote: z.string().trim().max(2000),
                }
              : {}),
          })
          .strict()
          .parse(r.body);
        await db.$transaction(async (tx) => {
          const i = await write(
            tx,
            r,
            String(r.params.id),
            String(r.params.iterationId),
            input.expectedVersion,
          );
          const link = await tx.iterationTask.findFirst({
            where: { iterationId: i.id, taskId: String(r.params.taskId) },
          });
          assert(link, '需求不在当前迭代', 404);
          if (method === 'delete')
            await tx.iterationTask.delete({ where: { id: link.id } });
          else {
            await milestone(tx, i, input.milestoneId as string | null);
            await tx.iterationTask.update({
              where: { id: link.id },
              data: {
                milestoneId: input.milestoneId as string | null,
                delayNote: input.delayNote as string,
              },
            });
          }
          const planned = await tx.task.findUniqueOrThrow({
            where: { id: link.taskId },
            select: { number: true, data: true },
          });
          await event(
            tx,
            r,
            i,
            method === 'delete' ? 'REMOVE_TASK' : 'UPDATE_TASK',
            {
              taskId: link.taskId,
              number: planned.number,
              title: (planned.data as any).title,
              previousMilestoneId: link.milestoneId,
              previousDelayNote: link.delayNote,
              ...(method === 'patch'
                ? { milestoneId: input.milestoneId, delayNote: input.delayNote }
                : {}),
            },
          );
        });
        s.status(204).end();
      }),
    );
  for (const method of ['post', 'patch', 'delete'] as const)
    router[method](
      '/projects/:id/iterations/:iterationId/milestones' +
        (method === 'post' ? '' : '/:milestoneId'),
      wrap(async (r, s) => {
        const version = expected.parse(r.body.expectedVersion),
          { expectedVersion, ...body } = r.body;
        const input = method === 'delete' ? null : milestoneInput.parse(body);
        await db.$transaction(async (tx) => {
          const i = await write(
            tx,
            r,
            String(r.params.id),
            String(r.params.iterationId),
            version,
          );
          const id = String(r.params.milestoneId || '');
          if (method !== 'post') await milestone(tx, i, id);
          if (input)
            assert(
              input.dueDate >= i.startDate && input.dueDate <= i.endDate,
              '里程碑日期须在迭代起止日期内',
              422,
            );
          if (method === 'post') {
            assert(
              (await tx.iterationMilestone.count({
                where: { iterationId: i.id },
              })) < 50,
              '每个迭代最多50个里程碑',
              422,
            );
            const created = await tx.iterationMilestone.create({
              data: { iterationId: i.id, ...input! },
            });
            await event(tx, r, i, 'ADD_MILESTONE', {
              milestoneId: created.id,
              ...input,
            });
          } else if (method === 'patch') {
            const previous = await tx.iterationMilestone.findUniqueOrThrow({
              where: { id },
            });
            await tx.iterationMilestone.update({ where: { id }, data: input! });
            await event(tx, r, i, 'UPDATE_MILESTONE', {
              milestoneId: id,
              before: { name: previous.name, dueDate: previous.dueDate },
              after: input,
            });
          } else {
            assert(
              !(await tx.iterationTask.count({ where: { milestoneId: id } })),
              '里程碑仍有需求，请先调整安排或移出',
              409,
            );
            const previous = await tx.iterationMilestone.findUniqueOrThrow({
              where: { id },
            });
            await tx.iterationMilestone.delete({ where: { id } });
            await event(tx, r, i, 'REMOVE_MILESTONE', {
              milestoneId: id,
              name: previous.name,
              dueDate: previous.dueDate,
            });
          }
        });
        s.status(204).end();
      }),
    );
  router.get(
    '/tasks/:id/iteration',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id));
      const link = await db.iterationTask.findUnique({
        where: { taskId: t.id },
      });
      if (!link) {
        s.json(null);
        return;
      }
      const i = await db.iteration.findFirst({
        where: { id: link.iterationId, projectId: t.projectId },
      });
      assert(i, '迭代不存在', 404);
      s.json({
        iterationId: i.id,
        name: i.name,
        startDate: i.startDate,
        endDate: i.endDate,
        milestone: link.milestoneId
          ? await db.iterationMilestone.findUnique({
              where: { id: link.milestoneId },
              select: { name: true, dueDate: true },
            })
          : null,
        delayNote: link.delayNote,
      });
    }),
  );
}
