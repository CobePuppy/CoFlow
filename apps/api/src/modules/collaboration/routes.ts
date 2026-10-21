import {
  notificationReadSchema,
  savedViewSchema,
} from '@coflow/contracts/collaboration.js';
import { z } from 'zod';
import { assert } from '../requirements/domain.js';

export function installCollaborationRoutes(
  router: any,
  { db, wrap, page }: any,
) {
  async function access(
    tx: any,
    userId: string,
    workspaceId: string,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR NO KEY UPDATE`;
    assert(
      await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      }),
      '资源不存在',
      404,
    );
  }
  async function visibleProjects(
    tx: any,
    userId: string,
    workspaceId?: string,
  ) {
    const memberships = await tx.workspaceMember.findMany({
      where: { userId, ...(workspaceId ? { workspaceId } : {}) },
      select: { workspaceId: true },
    });
    const assignments = await tx.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    return tx.project.findMany({
      where: {
        workspaceId: { in: memberships.map((m: any) => m.workspaceId) },
        id: { in: assignments.map((m: any) => m.projectId) },
      },
      select: { id: true },
    });
  }
  async function checkTarget(
    tx: any,
    r: any,
    workspaceId: string,
    projectId: string | null,
  ) {
    if (!projectId) return;
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    assert(
      await tx.project.findFirst({ where: { id: projectId, workspaceId } }),
      '项目不可访问',
      404,
    );
    assert(
      await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: r.user.id } },
      }),
      '项目不可访问',
      404,
    );
  }
  router.get(
    '/workspaces/:id/views',
    wrap(async (r: any, s: any) => {
      const workspaceId = String(r.params.id);
      await access(db, r.user.id, workspaceId);
      const projects = await visibleProjects(db, r.user.id, workspaceId);
      const items = await db.savedView.findMany({
        where: {
          workspaceId,
          userId: r.user.id,
          OR: [
            { projectId: null },
            { projectId: { in: projects.map((p: any) => p.id) } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      s.json({ items });
    }),
  );
  router.post(
    '/workspaces/:id/views',
    wrap(async (r: any, s: any) => {
      const workspaceId = String(r.params.id),
        input = savedViewSchema.parse(r.body);
      const item = await db.$transaction(async (tx: any) => {
        await access(tx, r.user.id, workspaceId, true);
        await checkTarget(tx, r, workspaceId, input.projectId);
        return tx.savedView.create({
          data: { ...input, workspaceId, userId: r.user.id },
        });
      });
      s.status(201).json(item);
    }),
  );
  router.patch(
    '/workspaces/:id/views/:viewId',
    wrap(async (r: any, s: any) => {
      const workspaceId = String(r.params.id);
      const { expectedVersion, ...content } = z
        .object({ expectedVersion: z.number().int().positive() })
        .passthrough()
        .parse(r.body);
      const input = savedViewSchema.parse(content);
      s.json(
        await db.$transaction(async (tx: any) => {
          await access(tx, r.user.id, workspaceId, true);
          await checkTarget(tx, r, workspaceId, input.projectId);
          const result = await tx.savedView.updateMany({
            where: {
              id: String(r.params.viewId),
              workspaceId,
              userId: r.user.id,
              version: expectedVersion,
            },
            data: { ...input, version: { increment: 1 } },
          });
          assert(result.count, '视图已更新或不可访问，请刷新', 409);
          return tx.savedView.findUnique({
            where: { id: String(r.params.viewId) },
          });
        }),
      );
    }),
  );
  router.delete(
    '/workspaces/:id/views/:viewId',
    wrap(async (r: any, s: any) => {
      const workspaceId = String(r.params.id);
      const { expectedVersion } = z
        .object({ expectedVersion: z.number().int().positive() })
        .strict()
        .parse(r.body);
      await db.$transaction(async (tx: any) => {
        await access(tx, r.user.id, workspaceId, true);
        const result = await tx.savedView.deleteMany({
          where: {
            id: String(r.params.viewId),
            workspaceId,
            userId: r.user.id,
            version: expectedVersion,
          },
        });
        assert(result.count, '视图已更新或不可访问，请刷新', 409);
      });
      s.json({ ok: true });
    }),
  );
  router.get(
    '/notifications',
    wrap(async (r: any, s: any) => {
      const workspaceId = r.query.workspace
        ? String(r.query.workspace)
        : undefined;
      const unread = z.enum(['true', 'false']).optional().parse(r.query.unread);
      const pagination = page(r);
      s.json(
        await db.$transaction(
          async (tx: any) => {
            if (workspaceId) await access(tx, r.user.id, workspaceId);
            const projects = await visibleProjects(tx, r.user.id, workspaceId);
            const base = {
              recipientId: r.user.id,
              ...(workspaceId ? { workspaceId } : {}),
              projectId: { in: projects.map((p: any) => p.id) },
            };
            const where = {
              ...base,
              ...(unread === 'true' ? { readAt: null } : {}),
            };
            const [total, unreadCount, items] = await Promise.all([
              tx.notification.count({ where }),
              tx.notification.count({ where: { ...base, readAt: null } }),
              tx.notification.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: (pagination.page - 1) * pagination.pageSize,
                take: pagination.pageSize,
              }),
            ]);
            return { ...pagination, total, unreadCount, items };
          },
          { isolationLevel: 'RepeatableRead' },
        ),
      );
    }),
  );
  router.post(
    '/notifications/read',
    wrap(async (r: any, s: any) => {
      const input = notificationReadSchema.parse(r.body),
        cutoff = new Date();
      const count = await db.$transaction(async (tx: any) => {
        await access(tx, r.user.id, input.workspaceId, true);
        // Membership changes use workspace/project locks; recheck inside them.
        await tx.$queryRaw`SELECT id FROM "Project" WHERE "workspaceId" = ${input.workspaceId} ORDER BY id FOR UPDATE`;
        const projects = await visibleProjects(
          tx,
          r.user.id,
          input.workspaceId,
        );
        const base = {
          recipientId: r.user.id,
          workspaceId: input.workspaceId,
          projectId: { in: projects.map((p: any) => p.id) },
        };
        const ids = 'ids' in input ? [...new Set(input.ids)] : null;
        if (ids)
          assert(
            (await tx.notification.count({
              where: { ...base, id: { in: ids } },
            })) === ids.length,
            '部分通知已不可访问，请刷新',
            404,
          );
        const result = await tx.notification.updateMany({
          where: {
            ...base,
            readAt: null,
            ...(ids ? { id: { in: ids } } : { createdAt: { lte: cutoff } }),
          },
          data: { readAt: cutoff },
        });
        return result.count;
      });
      s.json({ ok: true, count });
    }),
  );
}
