import { fileContent } from '../file-spaces/content.js';
import { taskResourceSummaries } from './resource-summaries.js';
import type { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import {
  db,
  page,
  projectWrite,
  record,
  storage,
  task,
  wrap,
} from '../../shared/access.js';
import { assert } from '../requirements/domain.js';
const kindSchema = z.enum(['DOCUMENT', 'FILE', 'ATTACHMENT']);
const inputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    kind: kindSchema,
    sourceId: z.string().uuid(),
    sourceVersion: z.number().int().positive(),
    fileVersion: z.number().int().positive().nullable().optional(),
    sharePersonal: z.boolean().default(false),
  })
  .strict();
async function source(
  tx: any,
  t: any,
  kind: string,
  id: string,
  fileVersion?: number | null,
) {
  if (kind === 'DOCUMENT') {
    const d = await tx.document.findUnique({ where: { id } });
    return d?.projectId === t.projectId
      ? { ...d, name: d.title, scope: 'PROJECT' }
      : null;
  }
  if (kind === 'ATTACHMENT') {
    const f = await tx.attachment.findUnique({ where: { id } });
    if (!f || f.projectId !== t.projectId) return null;
    if (
      f.taskId &&
      (await tx.task.findUnique({ where: { id: f.taskId } }))?.deletedAt
    )
      return null;
    return { ...f, version: 1, scope: 'PROJECT' };
  }
  const f = await tx.spaceFile.findUnique({ where: { id } });
  return f && (f.scope === 'PERSONAL' || f.workspaceId === t.workspaceId)
    ? fileContent(tx, f, fileVersion ?? undefined)
    : null;
}
async function lockedTask(tx: any, r: any, t: any, expected: number) {
  await projectWrite(tx, r, t.projectId);
  const result = await tx.task.updateMany({
    where: {
      id: t.id,
      projectId: t.projectId,
      version: expected,
      deletedAt: null,
    },
    data: { version: { increment: 1 } },
  });
  assert(result.count, '需求已更新，请保留选择并刷新', 409);
  return tx.task.findUniqueOrThrow({ where: { id: t.id } });
}
async function canManage(tx: any, r: any, t: any, ref: any) {
  return (
    ref.createdBy === r.user.id ||
    t.data.productId === r.user.id ||
    (
      await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: t.workspaceId, userId: r.user.id },
        },
      })
    )?.role === 'ADMIN'
  );
}
async function readableTask(tx: any, r: any, id: string) {
  const t = await tx.task.findUnique({ where: { id } });
  assert(t, '资源不存在', 404);
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${t.projectId} FOR SHARE`;
  const p = await tx.project.findUnique({ where: { id: t.projectId } });
  assert(
    p &&
      (await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: t.workspaceId, userId: r.user.id },
        },
      })) &&
      (await tx.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: t.projectId, userId: r.user.id },
        },
      })),
    '资源不存在',
    404,
  );
  return t;
}
export function installTaskResourceRoutes(router: Router) {
  router.use(
    ['/tasks/:id/resources', '/space-files/:id/references'],
    (_r, s, next) => {
      s.setHeader('Cache-Control', 'private, no-store');
      next();
    },
  );
  router.get(
    '/tasks/:id/resources/candidates',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id));
      const pagination = page(r);
      const scope = z
        .enum(['TEAM', 'PERSONAL', 'DOCUMENT', 'ATTACHMENT'])
        .parse(r.query.scope || 'TEAM');
      const q = z
        .string()
        .trim()
        .max(200)
        .parse(r.query.q || '');
      const result = await db.$transaction(
        async (tx) => {
          const model =
            scope === 'DOCUMENT'
              ? tx.document
              : scope === 'ATTACHMENT'
                ? tx.attachment
                : tx.spaceFile;
          const where: any =
            scope === 'DOCUMENT'
              ? {
                  projectId: t.projectId,
                  title: { contains: q, mode: 'insensitive' },
                }
              : scope === 'ATTACHMENT'
                ? {
                    projectId: t.projectId,
                    deletedAt: null,
                    name: { contains: q, mode: 'insensitive' },
                    OR: [
                      { taskId: null },
                      {
                        taskId: {
                          in: (
                            await tx.task.findMany({
                              where: {
                                projectId: t.projectId,
                                deletedAt: null,
                              },
                              select: { id: true },
                            })
                          ).map((x) => x.id),
                        },
                      },
                    ],
                  }
                : {
                    scope,
                    deletedAt: null,
                    ...(scope === 'TEAM'
                      ? { workspaceId: t.workspaceId }
                      : { ownerId: r.user.id }),
                    name: { contains: q, mode: 'insensitive' },
                  };
          const total = await (model as any).count({ where });
          const rows = await (model as any).findMany({
            where,
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
            orderBy: [
              { [scope === 'DOCUMENT' ? 'updatedAt' : 'createdAt']: 'desc' },
              { id: 'asc' },
            ],
          });
          return {
            ...pagination,
            total,
            items: rows.map((f: any) => ({
              id: f.id,
              name: f.title || f.name,
              version: f.version || 1,
              contentVersion: f.contentVersion,
              kind:
                scope === 'DOCUMENT'
                  ? 'DOCUMENT'
                  : scope === 'ATTACHMENT'
                    ? 'ATTACHMENT'
                    : 'FILE',
              scope,
            })),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.get(
    '/tasks/:id/resources',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id));
      const result = await db.$transaction(
        (tx) => taskResourceSummaries(tx, t, r.user.id),
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.post(
    '/tasks/:id/resources',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id), true),
        input = inputSchema.parse(r.body);
      const result = await db.$transaction(async (tx) => {
        const current = await lockedTask(tx, r, t, input.expectedVersion);
        if (input.kind === 'FILE')
          await tx.$queryRaw`SELECT id FROM "SpaceFile" WHERE id=${input.sourceId} FOR SHARE`;
        if (input.kind === 'DOCUMENT')
          await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${input.sourceId} FOR SHARE`;
        if (input.kind === 'ATTACHMENT')
          await tx.$queryRaw`SELECT id FROM "Attachment" WHERE id=${input.sourceId} FOR SHARE`;
        assert(
          input.kind === 'FILE' || input.fileVersion == null,
          '只有空间文件支持固定内容版本',
        );
        const f = await source(
          tx,
          current,
          input.kind,
          input.sourceId,
          input.fileVersion,
        );
        assert(f && !f.deletedAt, '资料不存在或无权引用', 404);
        if (f.scope === 'PERSONAL') {
          assert(f.ownerId === r.user.id, '资料不存在或无权引用', 404);
          assert(
            input.sharePersonal,
            '请明确授权本需求所在项目的成员访问该个人文件',
            422,
          );
        }
        assert(
          f.version === input.sourceVersion,
          '资料已更新，请刷新候选资料后重新确认',
          409,
        );
        assert(
          !(await tx.taskResource.findUnique({
            where: {
              taskId_kind_sourceId: {
                taskId: t.id,
                kind: input.kind,
                sourceId: input.sourceId,
              },
            },
          })),
          '该资料已引用',
          409,
        );
        assert(
          (await tx.taskResource.count({ where: { taskId: t.id } })) < 100,
          '每项需求最多引用100份资料',
          422,
        );
        const ref = await tx.taskResource.create({
          data: {
            taskId: t.id,
            kind: input.kind,
            sourceId: f.id,
            sourceVersion: f.version,
            fileVersion: input.fileVersion ?? null,
            title: f.name,
            sourceScope: f.scope,
            personalShared: f.scope === 'PERSONAL',
            createdBy: r.user.id,
            taskTitle: current.data.title,
          },
        });
        await record(tx, r, t.workspaceId, t.id, 'TASK_RESOURCE_LINK');
        return ref;
      });
      s.status(201).json({ id: result.id });
    }),
  );
  for (const operation of ['unlink', 'refresh'] as const)
    router[operation === 'unlink' ? 'delete' : 'post'](
      '/tasks/:id/resources/:refId' +
        (operation === 'refresh' ? '/refresh' : ''),
      wrap(async (r, s) => {
        const t = await task(r, String(r.params.id), true);
        const input = z
          .object({
            expectedVersion: z.number().int().positive(),
            ...(operation === 'refresh'
              ? {
                  sourceVersion: z.number().int().positive(),
                  fileVersion: z
                    .number()
                    .int()
                    .positive()
                    .nullable()
                    .optional(),
                }
              : {}),
          })
          .strict()
          .parse(r.body);
        const expected = input.expectedVersion;
        await db.$transaction(async (tx) => {
          const current = await lockedTask(tx, r, t, expected);
          const ref = await tx.taskResource.findUnique({
            where: { id: String(r.params.refId) },
          });
          assert(ref && ref.taskId === t.id, '引用不存在', 404);
          assert(
            await canManage(tx, r, current, ref),
            '仅引用人、需求负责人或团队管理员可维护引用',
            403,
          );
          if (operation === 'unlink')
            await tx.taskResource.delete({ where: { id: ref.id } });
          else {
            if (ref.kind === 'DOCUMENT')
              await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${ref.sourceId} FOR SHARE`;
            if (ref.kind === 'FILE')
              await tx.$queryRaw`SELECT id FROM "SpaceFile" WHERE id=${ref.sourceId} FOR SHARE`;
            const pinned =
              input.fileVersion === undefined
                ? ref.fileVersion
                : z
                    .number()
                    .int()
                    .positive()
                    .nullable()
                    .parse(input.fileVersion);
            assert(
              ref.kind === 'FILE' || pinned == null,
              '只有空间文件支持固定内容版本',
            );
            const f = await source(tx, current, ref.kind, ref.sourceId, pinned);
            assert(f && !f.deletedAt, '资料已失效', 409);
            if (f.scope === 'PERSONAL' && pinned !== ref.fileVersion)
              assert(
                f.ownerId === r.user.id,
                '个人文件引用方式只能由文件所有者调整',
                403,
              );
            assert(
              f.version === input.sourceVersion,
              '资料再次更新，请重新查看核对',
              409,
            );
            await tx.taskResource.update({
              where: { id: ref.id },
              data: {
                title: f.name,
                sourceVersion: f.version,
                fileVersion: pinned ?? null,
              },
            });
          }
          await record(
            tx,
            r,
            t.workspaceId,
            t.id,
            'TASK_RESOURCE_' + operation.toUpperCase(),
          );
        });
        s.status(204).end();
      }),
    );
  router.get(
    '/tasks/:id/resources/:refId/download',
    wrap(async (r, s) => {
      const f = await db.$transaction(async (tx) => {
        const t = await readableTask(tx, r, String(r.params.id));
        assert(!t.deletedAt, '需求已删除', 404);
        const ref = await tx.taskResource.findUnique({
          where: { id: String(r.params.refId) },
        });
        assert(
          ref && ref.taskId === t.id && ref.kind !== 'DOCUMENT',
          '引用不存在',
          404,
        );
        const f = await source(tx, t, ref.kind, ref.sourceId, ref.fileVersion);
        assert(
          f && !f.deletedAt && (f.scope !== 'PERSONAL' || ref.personalShared),
          '资料已失效',
          404,
        );
        return f;
      });
      s.setHeader('X-Content-Type-Options', 'nosniff');
      s.download(path.join(storage, f.key), f.name);
    }),
  );
  router.get(
    '/space-files/:id/references',
    wrap(async (r, s) => {
      const file = await db.spaceFile.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(
        file?.scope === 'PERSONAL' && file.ownerId === r.user.id,
        '资源不存在',
        404,
      );
      const pagination = page(r);
      const where = { kind: 'FILE', sourceId: file.id, personalShared: true };
      s.json({
        ...pagination,
        total: await db.taskResource.count({ where }),
        items: await db.taskResource.findMany({
          where,
          select: { id: true, taskTitle: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (pagination.page - 1) * pagination.pageSize,
          take: pagination.pageSize,
        }),
      });
    }),
  );
  router.delete(
    '/space-files/:id/references/:refId',
    wrap(async (r, s) => {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "SpaceFile" WHERE id=${String(r.params.id)} FOR UPDATE`;
        const f = await tx.spaceFile.findUnique({
          where: { id: String(r.params.id) },
        });
        assert(
          f?.scope === 'PERSONAL' && f.ownerId === r.user.id,
          '资源不存在',
          404,
        );
        const ref = await tx.taskResource.findUnique({
          where: { id: String(r.params.refId) },
        });
        assert(
          ref &&
            ref.kind === 'FILE' &&
            ref.sourceId === f.id &&
            ref.personalShared,
          '授权不存在',
          404,
        );
        await tx.taskResource.delete({ where: { id: ref.id } });
        await tx.spaceFileEvent.create({
          data: {
            fileId: f.id,
            actorId: r.user.id,
            action: 'TASK_RESOURCE_REVOKE',
          },
        });
      });
      s.status(204).end();
    }),
  );
}
