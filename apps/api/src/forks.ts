import { z } from 'zod';
import { assert } from './domain.js';
import type { ProjectFork } from '../../../packages/contracts/forks.js';

const text = z.string().trim().min(1).max(2000);
export const forkRouteSchema = z
  .object({
    name: text.max(100),
    hypothesis: text,
    plan: z.string().max(10000),
    hoursBudget: z.number().positive().max(10000),
    costBudget: z.number().min(0).max(10000000),
    deadline: z.union([z.literal(''), z.iso.date()]),
    actualHours: z.number().min(0).max(100000).nullable(),
    actualCost: z.number().min(0).max(100000000).nullable(),
    outcome: z.string().max(10000),
    artifacts: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: text.max(200),
            content: z.string().trim().min(1).max(100000),
          })
          .strict(),
      )
      .max(20),
    experiments: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: text.max(200),
            ownerId: z.union([z.uuid(), z.literal('')]),
            status: z.enum(['TODO', 'DOING', 'DONE']),
            result: z.string().max(10000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((route, ctx) => {
    for (const item of route.experiments)
      if (item.status === 'DONE' && !item.result.trim())
        ctx.addIssue({
          code: 'custom',
          message: '完成试验需要填写实际结果',
          path: ['experiments'],
        });
    for (const key of ['experiments', 'artifacts'] as const)
      if (new Set(route[key].map((x) => x.id)).size !== route[key].length)
        ctx.addIssue({ code: 'custom', message: '条目编号重复', path: [key] });
  });
export const forkCreateSchema = z
  .object({
    title: text.max(200),
    goal: text,
    criterion: text,
    documentIds: z.array(z.uuid()).max(20).default([]),
    taskIds: z.array(z.uuid()).max(100).default([]),
    routes: z.array(forkRouteSchema).length(2),
  })
  .strict();
export const forkDecisionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    selectedRoute: z.number().int().min(0).max(1),
    reason: z.string().trim().min(10).max(10000),
    artifactIds: z.array(z.uuid()).max(40),
  })
  .strict();

export function installForkRoutes(router: any, deps: any) {
  const { db, wrap, project, projectWrite, record } = deps;
  const load = async (r: any, write = false) => {
    const item = await db.projectFork.findUnique({
      where: { id: String(r.params.id) },
    });
    assert(item, '资源不存在', 404);
    await project(r, item.projectId, write);
    return item as ProjectFork;
  };
  const owners = async (tx: any, projectId: string, routes: any[]) => {
    const members = await tx.projectMember.findMany({ where: { projectId } });
    for (const route of routes)
      for (const experiment of route.experiments)
        assert(
          !experiment.ownerId ||
            members.some((m: any) => m.userId === experiment.ownerId),
          '试验负责人必须属于当前项目',
        );
  };
  router.get(
    '/projects/:id/forks',
    wrap(async (r: any, s: any) => {
      const p = await project(r, String(r.params.id));
      const deleted = await db.task.findMany({
        where: { projectId: p.id, deletedAt: { not: null } },
        select: { id: true },
      });
      s.json({
        readOnly: !!p.archivedAt,
        items: (
          await db.projectFork.findMany({
            where: { projectId: p.id },
            orderBy: { updatedAt: 'desc' },
          })
        ).map((item: any) => ({
          ...item,
          deletedTaskIds: deleted.map((t: any) => t.id),
        })),
      });
    }),
  );
  router.post(
    '/projects/:id/forks',
    wrap(async (r: any, s: any) => {
      const input = forkCreateSchema.parse(r.body);
      const p = await project(r, String(r.params.id), true);
      s.json(
        await db.$transaction(async (tx: any) => {
          const current = await projectWrite(tx, r, p.id);
          await owners(tx, p.id, input.routes);
          const documents = await tx.document.findMany({
            where: { projectId: p.id, id: { in: input.documentIds } },
            select: { id: true, title: true, content: true, version: true },
          });
          const tasks = await tx.task.findMany({
            where: {
              projectId: p.id,
              id: { in: input.taskIds },
              deletedAt: null,
            },
          });
          assert(
            documents.length === new Set(input.documentIds).size &&
              tasks.length === new Set(input.taskIds).size,
            '上下文必须属于当前项目',
          );
          const item = await tx.projectFork.create({
            data: {
              projectId: p.id,
              workspaceId: p.workspaceId,
              title: input.title,
              goal: input.goal,
              criterion: input.criterion,
              data: {
                routes: input.routes,
                snapshot: {
                  at: new Date().toISOString(),
                  description: current.description,
                  documents,
                  tasks: tasks.map((t: any) => ({
                    id: t.id,
                    number: t.number,
                    title: t.data.title,
                    status: t.status,
                    version: t.version,
                  })),
                },
              },
            },
          });
          await record(tx, r, p.workspaceId, item.id, 'FORK_CREATE');
          return item;
        }),
      );
    }),
  );
  router.patch(
    '/forks/:id/routes/:route',
    wrap(async (r: any, s: any) => {
      const item = await load(r, true);
      const index = z.coerce.number().int().min(0).max(1).parse(r.params.route);
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          route: forkRouteSchema,
        })
        .strict()
        .parse(r.body);
      s.json(
        await db.$transaction(async (tx: any) => {
          await projectWrite(tx, r, item.projectId);
          const latest = await tx.projectFork.findUnique({
            where: { id: item.id },
          });
          assert(
            latest.version === input.expectedVersion,
            '分身已更新，请保留输入并刷新',
            409,
          );
          assert(!latest.data.decision, '已决策的分身只读', 409);
          await owners(tx, item.projectId, [input.route]);
          const data = latest.data;
          data.routes[index] = input.route;
          const updated = await tx.projectFork.update({
            where: { id: item.id },
            data: { data, version: { increment: 1 } },
          });
          await record(tx, r, latest.workspaceId, item.id, 'FORK_ROUTE_UPDATE');
          return updated;
        }),
      );
    }),
  );
  router.post(
    '/forks/:id/decide',
    wrap(async (r: any, s: any) => {
      const item = await load(r, true),
        input = forkDecisionSchema.parse(r.body);
      s.json(
        await db.$transaction(async (tx: any) => {
          await projectWrite(tx, r, item.projectId);
          const latest = await tx.projectFork.findUnique({
            where: { id: item.id },
          });
          assert(
            latest.version === input.expectedVersion,
            '分身已更新，请刷新后重新决策',
            409,
          );
          const data = latest.data as ProjectFork['data'];
          assert(!data.decision, '已经决策，请勿重复合并', 409);
          const chosen = data.routes[input.selectedRoute];
          assert(
            chosen.outcome.trim() &&
              chosen.actualHours !== null &&
              chosen.actualCost !== null,
            '请先记录选定路线的实际投入与结论',
          );
          assert(
            chosen.experiments.length &&
              chosen.experiments.every((x) => x.status === 'DONE'),
            '选定路线的试验必须全部完成',
          );
          const artifacts = data.routes.flatMap((route) => route.artifacts);
          assert(
            new Set(input.artifactIds).size === input.artifactIds.length &&
              input.artifactIds.every(
                (id) => artifacts.filter((a) => a.id === id).length === 1,
              ),
            '保留成果不存在或编号重复',
          );
          const documentIds: string[] = [];
          const createDocument = async (title: string, content: string) => {
            const d = await tx.document.create({
              data: {
                projectId: item.projectId,
                workspaceId: latest.workspaceId,
                title,
                content,
                taskIds: [],
                revisions: [
                  {
                    title,
                    content,
                    taskIds: [],
                    version: 1,
                    by: r.user.id,
                    at: new Date().toISOString(),
                  },
                ],
              },
            });
            documentIds.push(d.id);
            await record(tx, r, latest.workspaceId, d.id, 'DOCUMENT_CREATE');
          };
          for (const id of input.artifactIds) {
            const a = artifacts.find((a) => a.id === id)!;
            await createDocument(a.title, a.content);
          }
          await createDocument(
            ('项目分身决策 · ' + latest.title).slice(0, 200),
            `# ${latest.title}\n\n共同目标：${latest.goal}\n\n比较标准：${latest.criterion}\n\n选择：${chosen.name}\n\n理由：${input.reason}\n\n` +
              data.routes
                .map(
                  (route, i) =>
                    `## 路线 ${i + 1}：${route.name}\n\n假设：${route.hypothesis}\n\n计划：${route.plan}\n\n预算：${route.hoursBudget} 人时 / ${route.costBudget} 元；截止：${route.deadline || '未设置'}\n\n实际：${route.actualHours ?? '未记录'} 人时 / ${route.actualCost ?? '未记录'} 元\n\n结论：${route.outcome || '未记录'}\n\n` +
                    route.experiments
                      .map((e) => `- ${e.title} [${e.status}]：${e.result}`)
                      .join('\n'),
                )
                .join('\n\n'),
          );
          data.decision = {
            selectedRoute: input.selectedRoute,
            reason: input.reason,
            by: r.user.id,
            at: new Date().toISOString(),
            documentIds,
            retained: input.artifactIds,
          };
          const updated = await tx.projectFork.update({
            where: { id: item.id },
            data: { data: data as any, version: { increment: 1 } },
          });
          await record(tx, r, latest.workspaceId, item.id, 'FORK_DECIDE');
          return updated;
        }),
      );
    }),
  );
}
