import { z } from 'zod';
import { assert } from './domain.js';

export const attachmentStage = z.enum([
  'GENERAL',
  'REQUIREMENT',
  'SOLUTION',
  'REVIEW',
  'DEVELOPMENT',
  'TESTING',
  'ACCEPTANCE',
]);
export function attachmentVersion(t: any, stage: string): number | null {
  if (!t) return null;
  const d = t.data;
  if (stage === 'REQUIREMENT')
    return d.requirementVersion + (t.status === 'DRAFT' ? 1 : 0);
  if (stage === 'SOLUTION' || stage === 'REVIEW')
    return Math.max(
      1,
      d.solutions.length +
        (stage === 'SOLUTION' && t.status === 'SOLUTION_PENDING' ? 1 : 0),
    );
  if (['DEVELOPMENT', 'TESTING', 'ACCEPTANCE'].includes(stage))
    return Math.max(
      1,
      d.tests.length +
        (stage === 'DEVELOPMENT' && t.status === 'DEVELOPING' ? 1 : 0),
    );
  return null;
}
export async function attachmentList(
  db: any,
  r: any,
  project: any,
  where: any,
  includeDeleted = false,
) {
  const member = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: project.workspaceId,
        userId: r.user.id,
      },
    },
  });
  const admin = member?.role === 'ADMIN';
  const items = await db.attachment.findMany({
    where: {
      ...where,
      ...(includeDeleted
        ? admin
          ? {}
          : { OR: [{ deletedAt: null }, { userId: r.user.id }] }
        : { deletedAt: null }),
    },
    orderBy: { createdAt: 'desc' },
  });
  const deletedTasks = new Set(
    (
      await db.task.findMany({
        where: {
          projectId: project.id,
          id: { in: items.map((a: any) => a.taskId).filter(Boolean) },
          deletedAt: { not: null },
        },
        select: { id: true },
      })
    ).map((t: any) => t.id),
  );
  return items.map((a: any) => ({
    id: a.id,
    name: a.name,
    mime: a.mime,
    size: a.size,
    taskId: a.taskId,
    userId: a.userId,
    createdAt: a.createdAt,
    stage: a.stage,
    stageVersion: a.stageVersion,
    deletedAt: a.deletedAt,
    canDelete:
      !project.archivedAt &&
      !deletedTasks.has(a.taskId) &&
      (admin || a.userId === r.user.id),
  }));
}
export function installAttachmentRoutes(
  router: any,
  { db, wrap, task, project, projectWrite, record }: any,
) {
  router.get(
    '/tasks/:id/attachments',
    wrap(async (r: any, s: any) => {
      const t = await task(r, String(r.params.id));
      const p = await project(r, t.projectId);
      s.json(
        await attachmentList(
          db,
          r,
          p,
          { taskId: t.id },
          r.query.includeDeleted === 'true',
        ),
      );
    }),
  );
  for (const restore of [false, true]) {
    router[restore ? 'post' : 'delete'](
      '/attachments/:id' + (restore ? '/restore' : ''),
      wrap(async (r: any, s: any) => {
        const a = await db.attachment.findUnique({
          where: { id: String(r.params.id) },
        });
        assert(a, '附件不存在', 404);
        const p = await project(r, a.projectId, true, true);
        await db.$transaction(async (tx: any) => {
          await projectWrite(tx, r, p.id, true);
          if (a.taskId) {
            const parent = await tx.task.findUnique({
              where: { id: a.taskId },
            });
            assert(
              parent && !parent.deletedAt,
              '需求已移入回收站，请先恢复',
              409,
            );
          }
          const member = await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: p.workspaceId,
                userId: r.user.id,
              },
            },
          });
          assert(
            a.userId === r.user.id || member?.role === 'ADMIN',
            '仅上传人或团队管理员可删除或恢复附件',
            403,
          );
          const changed = await tx.attachment.updateMany({
            where: { id: a.id, deletedAt: restore ? { not: null } : null },
            data: {
              deletedAt: restore ? null : new Date(),
              deletedBy: restore ? null : r.user.id,
            },
          });
          if (changed.count)
            await record(
              tx,
              r,
              p.workspaceId,
              a.taskId || p.id,
              restore ? 'ATTACHMENT_RESTORE' : 'ATTACHMENT_DELETE',
            );
        });
        s.json({ ok: true });
      }),
    );
  }
}
