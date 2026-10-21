import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import {
  db,
  documentInput,
  project,
  projectWrite,
  record,
  task,
  wrap,
} from '../../shared/context.js';
export function installDocumentsRoutes(router: express.Router) {
  router.get(
    '/projects/:id/documents',
    wrap(async (r, s) => {
      await project(r, String(r.params.id));
      s.json(
        await db.document.findMany({
          where: { projectId: String(r.params.id) },
        }),
      );
    }),
  );

  router.post(
    '/projects/:id/documents',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id), true),
        input = await documentInput(r, p.id);
      s.json(
        await db.$transaction(async (tx) => {
          await projectWrite(tx, r, p.id);
          const d = await tx.document.create({
            data: {
              workspaceId: p.workspaceId,
              projectId: p.id,
              ...input,
              revisions: [
                {
                  ...input,
                  version: 1,
                  by: r.user.id,
                  at: new Date().toISOString(),
                },
              ],
            },
          });
          await record(tx, r, p.workspaceId, d.id, 'DOCUMENT_CREATE');
          return d;
        }),
      );
    }),
  );

  router.get(
    '/tasks/:id/documents',
    wrap(async (r, s) => {
      const t = await task(r, String(r.params.id));
      s.json(
        await db.document.findMany({
          where: { projectId: t.projectId, taskIds: { has: t.id } },
          select: {
            id: true,
            title: true,
            version: true,
            updatedAt: true,
            projectId: true,
            workspaceId: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        }),
      );
    }),
  );

  router.get(
    '/documents/:id/tasks',
    wrap(async (r, s) => {
      const document = await db.document.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(document, '资源不存在', 404);
      await project(r, document.projectId);
      const rows = await db.task.findMany({
        where: {
          projectId: document.projectId,
          id: {
            in: [
              ...document.taskIds,
              ...(
                await db.taskResource.findMany({
                  where: { kind: 'DOCUMENT', sourceId: document.id },
                  select: { taskId: true },
                })
              ).map((ref) => ref.taskId),
            ],
          },
        },
        select: {
          id: true,
          number: true,
          status: true,
          data: true,
          deletedAt: true,
        },
        orderBy: { number: 'asc' },
      });
      s.json(
        rows.map((row) => ({
          id: row.id,
          number: row.number,
          deletedAt: row.deletedAt,
          status: row.status,
          title: (row.data as any).title,
        })),
      );
    }),
  );

  router.get(
    '/documents/:id',
    wrap(async (r, s) => {
      const d = await db.document.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(d, '资源不存在', 404);
      await project(r, d.projectId);
      s.json(d);
    }),
  );

  router.get(
    '/documents/:id/revisions',
    wrap(async (r, s) => {
      const d = await db.document.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(d, '资源不存在', 404);
      await project(r, d.projectId);
      s.json(d.revisions);
    }),
  );

  router.patch(
    '/documents/:id',
    wrap(async (r, s) => {
      const d = await db.document.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(d, '资源不存在', 404);
      await project(r, d.projectId, true);
      const input = await documentInput(r, d.projectId);
      assert(
        z.number().int().positive().parse(r.body.expectedVersion) === d.version,
        '文档版本冲突，请保留输入并刷新',
        409,
      );
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, d.projectId);
        const u = await tx.document.updateMany({
          where: {
            id: d.id,
            version: z.number().int().parse(r.body.expectedVersion),
          },
          data: {
            ...input,
            version: { increment: 1 },
            revisions: [
              ...(d.revisions as any[]),
              {
                ...input,
                version: d.version + 1,
                by: r.user.id,
                at: new Date().toISOString(),
              },
            ],
          },
        });
        assert(u.count, '文档版本冲突，请复制本地内容后重新加载', 409);
        await record(tx, r, d.workspaceId, d.id, 'DOCUMENT_REVISE');
      });
      s.json({ ok: true });
    }),
  );
}
