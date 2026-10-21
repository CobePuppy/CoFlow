import { access, scopeFor, visible, audit, type Scope } from './access.js';
import { fileContent } from './content.js';
import { fileTypes } from '@coflow/contracts/file-space.js';
import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, page, storage, wrap } from '../../shared/access.js';
import { upload } from '../attachments/service.js';
import { validateFile } from '../../infrastructure/storage/validation.js';
import { assert } from '../requirements/domain.js';

export function installFileSpaceRoutes(router: Router) {
  router.use(
    ['/me/files', '/workspaces/:workspaceId/files', '/space-files'],
    (_r, response, next) => {
      response.setHeader('Cache-Control', 'private, no-store');
      next();
    },
  );
  const collections = ['/me/files', '/workspaces/:workspaceId/files'];
  router.get(
    collections,
    wrap(async (r, s) => {
      const scope = scopeFor(r),
        pagination = page(r);
      const q = z
        .string()
        .trim()
        .max(200)
        .parse(r.query.q || '');
      const deleted =
        z.enum(['true', 'false']).parse(r.query.deleted || 'false') === 'true';
      const type = z
        .enum(['ALL', 'TEXT', 'IMAGE', 'PDF', 'OFFICE', 'ARCHIVE'])
        .parse(r.query.type || 'ALL');
      const sort = z
        .enum(['newest', 'updated', 'name', 'size'])
        .parse(r.query.sort || 'newest');
      const uploader = z.enum(['ALL', 'MINE']).parse(r.query.uploader || 'ALL');
      const result = await db.$transaction(
        async (tx) => {
          const admin = await access(tx, r, scope);
          const where = {
            ...scope,
            deletedAt: deleted ? { not: null } : null,
            ...((deleted && !admin) || uploader === 'MINE'
              ? { userId: r.user.id }
              : {}),
            ...(type !== 'ALL'
              ? { mime: { in: fileTypes.find((t) => t.value === type)!.mimes } }
              : {}),
            ...(q
              ? { name: { contains: q, mode: 'insensitive' as const } }
              : {}),
          };
          const total = await tx.spaceFile.count({ where });
          const rows = await tx.spaceFile.findMany({
            where,
            orderBy: [
              sort === 'name'
                ? { name: 'asc' }
                : sort === 'size'
                  ? { size: 'desc' }
                  : sort === 'updated'
                    ? { updatedAt: 'desc' }
                    : { createdAt: 'desc' },
              { id: 'asc' },
            ],
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
          });
          return {
            ...pagination,
            total,
            items: rows.map((file) => visible(file, admin, r.user.id)),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.json(result);
    }),
  );
  router.post(
    collections,
    (r, s, next) => {
      db.$transaction((tx) => access(tx, r, scopeFor(r)))
        .then(() => upload.single('file')(r, s, next))
        .catch(next);
    },
    wrap(async (r, s) => {
      const scope = scopeFor(r),
        f = r.file;
      assert(f, '未选择文件');
      const validated = validateFile(f);
      const key = 'sf-' + randomUUID(),
        temp = path.join(storage, key + '.tmp'),
        dest = path.join(storage, key);
      await fs.mkdir(storage, { recursive: true });
      try {
        await fs.writeFile(temp, f.buffer, { flag: 'wx' });
        await fs.rename(temp, dest);
        const file = await db.$transaction(async (tx) => {
          const admin = await access(tx, r, scope, true);
          const item = await tx.spaceFile.create({
            data: {
              ...scope,
              userId: r.user.id,
              key,
              name: validated.name,
              mime: validated.mime,
              size: f.size,
            },
          });
          await tx.spaceFileRevision.create({
            data: {
              fileId: item.id,
              number: 1,
              key: item.key,
              name: item.name,
              mime: item.mime,
              size: item.size,
              summary: '首次上传',
              createdBy: r.user.id,
            },
          });
          await audit(tx, r, item, 'SPACE_FILE_UPLOAD');
          return visible(item, admin, r.user.id);
        });
        s.status(201).json(file);
      } catch (e) {
        await fs.rm(temp, { force: true });
        await fs.rm(dest, { force: true });
        throw e;
      }
    }),
  );
  router.get(
    '/space-files/:id',
    wrap(async (r, s) => {
      const file = await db.spaceFile.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(file, '文件不存在', 404);
      const result = await db.$transaction(async (tx) => {
        const admin = await access(tx, r, file as Scope);
        const current = await tx.spaceFile.findUniqueOrThrow({
          where: { id: file.id },
        });
        assert(
          !current.deletedAt || admin || current.userId === r.user.id,
          '文件不存在',
          404,
        );
        return visible(current, admin, r.user.id);
      });
      s.json(result);
    }),
  );
  router.get(
    '/space-files/:id/download',
    wrap(async (r, s) => {
      const initial = await db.spaceFile.findUnique({
        where: { id: String(r.params.id) },
      });
      assert(initial, '文件不存在', 404);
      const file = await db.$transaction(async (tx) => {
        await access(tx, r, initial as Scope);
        const current = await tx.spaceFile.findUnique({
          where: { id: initial.id },
        });
        assert(current && !current.deletedAt, '文件不存在', 404);
        const content = await fileContent(tx, current);
        assert(content, '文件内容版本不存在', 404);
        return content;
      });
      s.setHeader('X-Content-Type-Options', 'nosniff');
      s.setHeader('Cache-Control', 'private, no-store');
      s.download(path.join(storage, file.key), file.name);
    }),
  );
  for (const operation of ['rename', 'delete', 'restore'] as const) {
    const method =
      operation === 'rename'
        ? 'patch'
        : operation === 'delete'
          ? 'delete'
          : 'post';
    router[method](
      '/space-files/:id' + (operation === 'restore' ? '/restore' : ''),
      wrap(async (r, s) => {
        const input = z
          .object({
            expectedVersion: z.number().int().positive(),
            ...(operation === 'rename'
              ? {
                  name: z
                    .string()
                    .trim()
                    .min(1)
                    .max(200)
                    .regex(/^[^\/\\\x00-\x1f\x7f]+$/),
                }
              : {}),
          })
          .strict()
          .parse(r.body);
        const initial = await db.spaceFile.findUnique({
          where: { id: String(r.params.id) },
        });
        assert(initial, '文件不存在', 404);
        const file = await db.$transaction(async (tx) => {
          const admin = await access(tx, r, initial as Scope, true);
          await tx.$queryRaw`SELECT id FROM "SpaceFile" WHERE id=${initial.id} FOR UPDATE`;
          const current = await tx.spaceFile.findUniqueOrThrow({
            where: { id: initial.id },
          });
          assert(
            admin || current.userId === r.user.id,
            '仅上传者或团队管理员可以维护文件',
            403,
          );
          assert(
            current.version === input.expectedVersion,
            '文件已更新，请保留输入并刷新',
            409,
          );
          assert(
            operation === 'restore' ? !!current.deletedAt : !current.deletedAt,
            '文件状态已改变，请刷新',
            409,
          );
          if (operation === 'rename')
            assert(
              path.extname(String(input.name)).toLowerCase() ===
                path.extname(current.name).toLowerCase(),
              '重命名须保留原文件扩展名',
              422,
            );
          const changed = await tx.spaceFile.update({
            where: { id: current.id },
            data: {
              version: { increment: 1 },
              ...(operation === 'rename'
                ? { name: String(input.name) }
                : {
                    deletedAt: operation === 'delete' ? new Date() : null,
                    deletedBy: operation === 'delete' ? r.user.id : null,
                  }),
            },
          });
          await audit(tx, r, changed, 'SPACE_FILE_' + operation.toUpperCase());
          return visible(changed, admin, r.user.id);
        });
        s.json(file);
      }),
    );
  }
}
