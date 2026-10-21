import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import 'reflect-metadata';
import { validateFile } from '../../infrastructure/storage/validation.js';
import {
  db,
  project,
  projectWrite,
  record,
  storage,
  task,
  upload,
  wrap,
} from '../../shared/context.js';
import { assert } from '../requirements/domain.js';
import {
  attachmentList,
  attachmentStage,
  attachmentVersion,
} from './routes.js';
export function installAttachmentsRoutes(router: express.Router) {
  router.get(
    '/projects/:id/attachments',
    wrap(async (r, s) => {
      const p = await project(r, String(r.params.id));
      s.json(
        await attachmentList(
          db,
          r,
          p,
          { projectId: p.id },
          r.query.includeDeleted === 'true',
        ),
      );
    }),
  );

  router.post(
    ['/tasks/:id/attachments', '/projects/:id/attachments'],
    (r, s, n) => {
      (r.path.startsWith('/projects/')
        ? project(r, String(r.params.id), true)
        : task(r, String(r.params.id), true)
      )
        .then(() => upload.single('file')(r, s, n))
        .catch(n);
    },
    wrap(async (r, s) => {
      const t = r.path.startsWith('/projects/')
        ? null
        : await task(r, String(r.params.id), true);
      const p = await project(r, t?.projectId || String(r.params.id), true);
      const f = r.file;
      assert(f, '未选择文件');
      const stage = attachmentStage.parse(r.body.stage || 'GENERAL');
      const validated = validateFile(f),
        b = f.buffer;
      const key = randomUUID(),
        temp = path.join(storage, `${key}.tmp`),
        dest = path.join(storage, key);
      await fs.mkdir(storage, { recursive: true });
      try {
        await fs.writeFile(temp, b, { flag: 'wx' });
        await fs.rename(temp, dest);
        const a = await db.$transaction(async (tx) => {
          await projectWrite(tx, r, p.id);
          const attachmentTask = t
            ? await tx.task.findUnique({ where: { id: t.id } })
            : null;
          assert(
            !t || attachmentTask?.projectId === p.id,
            '需求归属已改变，请刷新后上传',
            409,
          );
          const item = await tx.attachment.create({
            data: {
              workspaceId: p.workspaceId,
              projectId: p.id,
              taskId: t?.id,
              key,
              name: validated.name,
              mime: validated.mime,
              size: f.size,
              userId: r.user.id,
              stage,
              stageVersion: attachmentVersion(attachmentTask, stage),
            },
          });
          await record(tx, r, p.workspaceId, t?.id || p.id, 'ATTACHMENT');
          return item;
        });
        s.json({ id: a.id, name: a.name });
      } catch (e) {
        await fs.rm(temp, { force: true });
        await fs.rm(dest, { force: true });
        throw e;
      }
    }),
  );

  router.get(
    '/attachments/:id/download',
    wrap(async (r, s) => {
      const a = await db.attachment.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(a && !a.deletedAt, '资源不存在', 404);
      if (a.taskId) await task(r, a.taskId);
      else await project(r, a.projectId);
      s.setHeader('X-Content-Type-Options', 'nosniff');
      s.download(path.join(storage, a.key), a.name);
    }),
  );
}
