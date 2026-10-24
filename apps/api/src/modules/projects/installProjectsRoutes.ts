import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { z } from 'zod';
import { assert, required } from '../requirements/domain.js';

import {
  db,
  members,
  page,
  project,
  projectWrite,
  record,
  workspace,
  wrap,
} from '../../shared/context.js';
export function installProjectsRoutes(router: express.Router) {
  router.get(
    '/workspaces/:id/projects',
    wrap(async (r, s) => {
      await workspace(r, String(r.params.id));
      const ms = await db.projectMember.findMany({
        where: { userId: r.user.id },
      });
      s.json(
        await db.project.findMany({
          where: {
            workspaceId: String(r.params.id),
            id: { in: ms.map((m) => m.projectId) },
          },
        }),
      );
    }),
  );

  router.post(
    '/workspaces/:id/projects',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      await workspace(r, id, true);
      required(r.body, ['name']);
      s.json(
        await db.$transaction(async (tx) => {
          const p = await tx.project.create({
            data: {
              workspaceId: id,
              name: r.body.name,
              description: r.body.description || '',
              workflow: z
                .enum(['SIMPLE', 'STANDARD'])
                .default('STANDARD')
                .parse(r.body.workflow),
            },
          });
          await tx.projectMember.create({
            data: { projectId: p.id, userId: r.user.id, roles: ['PRODUCT'] },
          });
          await record(tx, r, id, p.id, 'PROJECT_CREATE');
          return p;
        }),
      );
    }),
  );

  router.get(
    '/projects/:id',
    wrap(async (r, s) => s.json(await project(r, String(r.params.id)))),
  );

  router.patch(
    '/projects/:id',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id), false, true);
      await workspace(r, p.workspaceId, true);
      s.json(
        await db.$transaction(async (tx) => {
          const result = await tx.project.update({
            where: { id: p.id },
            data: {
              ...(typeof r.body.name === 'string'
                ? { name: z.string().trim().min(1).max(200).parse(r.body.name) }
                : {}),
              ...(typeof r.body.description === 'string'
                ? {
                    description: z
                      .string()
                      .max(10000)
                      .parse(r.body.description),
                  }
                : {}),
              ...(typeof r.body.archived === 'boolean'
                ? { archivedAt: r.body.archived ? new Date() : null }
                : {}),
            },
          });
          await record(
            tx,
            r,
            p.workspaceId,
            p.id,
            r.body.archived ? 'PROJECT_ARCHIVE' : 'PROJECT_UPDATE',
          );
          return result;
        }),
      );
    }),
  );

  router.delete(
    '/projects/:id',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id), false, true);
      await workspace(r, p.workspaceId, true);
      assert(r.body.confirmName === p.name, '请输入项目名称确认删除');
      assert(!p.archivedAt, '请先恢复项目，再删除空项目', 409);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${p.id} FOR UPDATE`;
        await workspace(r, p.workspaceId, true);
        const latest = await tx.project.findUnique({ where: { id: p.id } });
        assert(
          latest?.name === r.body.confirmName,
          '项目信息已变化，请刷新',
          409,
        );
        const counts = await Promise.all([
          tx.task.count({ where: { projectId: p.id } }),
          tx.document.count({ where: { projectId: p.id } }),
          tx.attachment.count({ where: { projectId: p.id } }),
          tx.competition.count({ where: { projectId: p.id } }),
          tx.requirementTemplate.count({ where: { projectId: p.id } }),
          tx.projectFork.count({ where: { projectId: p.id } }),
          tx.projectAction.count({ where: { projectId: p.id } }),
          tx.projectCheckpoint.count({ where: { projectId: p.id } }),
          tx.projectGoal.count({ where: { projectId: p.id } }),
        ]);
        assert(
          counts.every((n) => n === 0),
          '项目仍有需求、文档、附件、竞赛、模板、分身或推进记录，请先归档保留数据；仅空项目可永久删除',
          409,
        );
        await tx.projectMember.deleteMany({ where: { projectId: p.id } });
        await tx.project.delete({ where: { id: p.id } });
        await record(tx, r, p.workspaceId, p.id, 'PROJECT_DELETE');
      });
      s.json({ ok: true });
    }),
  );

  router.get(
    '/projects/:id/members',
    wrap(async (r, s) => {
      await project(r, String(r.params.id), false, true);
      s.json(await members(String(r.params.id)));
    }),
  );

  router.post(
    '/projects/:id/members',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id), true, true);
      await workspace(r, p.workspaceId, true);
      const roles = z
        .array(z.enum(['PRODUCT', 'ENGINEER', 'QA', 'OPS']))
        .min(1)
        .parse(r.body.roles);
      const userId = z.string().parse(r.body.userId);
      assert(
        await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: p.workspaceId, userId } },
        }),
        '该用户不是团队成员',
      );
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, p.id, true);
        assert(
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: p.workspaceId, userId },
            },
          }),
          '该用户不是团队成员',
        );
        const tasks = await tx.task.findMany({
          where: {
            projectId: p.id,
            status: { notIn: ['CLOSED', 'CANCELLED'] },
            deletedAt: null,
          },
        });
        for (const t of tasks) {
          const d = t.data as any;
          if (d.workflow === 'SIMPLE') continue;
          for (const [field, needed] of Object.entries({
            productId: ['PRODUCT'],
            engineerId: ['ENGINEER'],
            productReviewerId: ['PRODUCT'],
            qaReviewerId: ['QA'],
            testerId: ['QA', 'OPS'],
          }))
            if (d[field] === userId)
              assert(
                needed.some((x) => roles.includes(x as any)),
                '请先转交未结束任务责任，再更改角色',
              );
        }
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: p.id, userId } },
          create: { projectId: p.id, userId, roles },
          update: { roles },
        });
        await record(tx, r, p.workspaceId, p.id, 'PROJECT_MEMBER_ROLES');
      });
      s.json({ ok: true });
    }),
  );

  router.get(
    '/projects/:id/task-options',
    wrap(async (r, s) => {
      const projectId = String(r.params.id);
      await project(r, projectId);
      const pagination = page(r);
      const [total, rows] = await db.$transaction(
        [
          db.task.count({ where: { projectId, deletedAt: null } }),
          db.task.findMany({
            where: { projectId, deletedAt: null },
            select: { id: true, number: true, data: true },
            orderBy: { number: 'asc' },
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      s.json({
        ...pagination,
        total,
        items: rows.map((row) => ({
          id: row.id,
          title: (row.data as any).title,
        })),
      });
    }),
  );
}
