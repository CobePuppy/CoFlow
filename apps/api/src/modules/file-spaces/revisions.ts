import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, page, storage, wrap } from '../../shared/access.js';
import { assert } from '../requirements/domain.js';
import { access, audit, visible, type Scope } from './access.js';
import { fileContent } from './content.js';
import { upload } from '../attachments/service.js';
import { validateFile } from '../../infrastructure/storage/validation.js';
async function fileAccess(tx: any, r: any, write = false) {
  const original = await tx.spaceFile.findUnique({
    where: { id: String(r.params.id) },
  });
  assert(original, '文件不存在', 404);
  const admin = await access(tx, r, original as Scope, write);
  if (write)
    await tx.$queryRaw`SELECT id FROM "SpaceFile" WHERE id=${original.id} FOR UPDATE`;
  const file = await tx.spaceFile.findUniqueOrThrow({
    where: { id: original.id },
  });
  const manage = admin || file.userId === r.user.id;
  assert(!file.deletedAt || manage, '文件不存在', 404);
  if (write) {
    assert(manage, '仅上传者或团队管理员可以维护文件版本', 403);
    assert(!file.deletedAt, '请先恢复文件', 409);
  }
  return { file, admin };
}
async function append(
  tx: any,
  r: any,
  f: any,
  input: { expectedVersion: number; summary: string },
  content: { key: string; mime: string; size: number },
) {
  assert(
    f.version === input.expectedVersion,
    '文件已更新，请保留说明并刷新后核对',
    409,
  );
  assert(f.contentVersion < 1000, '单个文件最多保留1000个内容版本');
  const number = f.contentVersion + 1;
  await tx.spaceFileRevision.create({
    data: {
      fileId: f.id,
      number,
      ...content,
      name: f.name,
      summary: input.summary,
      createdBy: r.user.id,
    },
  });
  const updated = await tx.spaceFile.update({
    where: { id: f.id },
    data: {
      contentVersion: number,
      version: { increment: 1 },
      mime: content.mime,
      size: content.size,
    },
  });
  await audit(tx, r, updated, 'SPACE_FILE_REVISION');
  return updated;
}
export function installFileRevisionRoutes(router: Router) {
  router.get(
    '/space-files/:id/revisions',
    wrap(async (r, s) => {
      const pagination = page(r);
      const result = await db.$transaction(
        async (tx) => {
          const { file, admin } = await fileAccess(tx, r);
          const total = await tx.spaceFileRevision.count({
            where: { fileId: file.id },
          });
          const rows = await tx.spaceFileRevision.findMany({
            where: { fileId: file.id },
            orderBy: { number: 'desc' },
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
            select: {
              number: true,
              name: true,
              mime: true,
              size: true,
              summary: true,
              createdBy: true,
              createdAt: true,
            },
          });
          const users = await tx.user.findMany({
            where: { id: { in: [...new Set(rows.map((x) => x.createdBy))] } },
            select: { id: true, name: true },
          });
          return {
            ...pagination,
            total,
            file: visible(file, admin, r.user.id),
            items: rows.map((row) => ({
              ...row,
              createdByName:
                users.find((u) => u.id === row.createdBy)?.name || '历史成员',
            })),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
    }),
  );
  router.get(
    '/space-files/:id/revisions/:number/download',
    wrap(async (r, s) => {
      const number = z.coerce.number().int().positive().parse(r.params.number);
      const content = await db.$transaction(async (tx) => {
        const { file } = await fileAccess(tx, r);
        assert(!file.deletedAt, '文件已删除', 404);
        const revision = await fileContent(tx, file, number);
        assert(revision, '版本不存在', 404);
        return revision;
      });
      s.setHeader('Cache-Control', 'private, no-store');
      s.setHeader('X-Content-Type-Options', 'nosniff');
      s.download(path.join(storage, content.key), content.name);
    }),
  );
  router.post(
    '/space-files/:id/revisions',
    (r: any, s, next) => {
      db.$transaction(async (tx) => {
        const { file, admin } = await fileAccess(tx, r);
        assert(admin || file.userId === r.user.id, '无权上传新版本', 403);
        assert(!file.deletedAt, '请先恢复文件', 409);
      })
        .then(() => upload.single('file')(r, s, next))
        .catch(next);
    },
    wrap(async (r, s) => {
      const input = z
        .object({
          expectedVersion: z.coerce.number().int().positive(),
          summary: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(r.body);
      assert(r.file, '未选择文件');
      const validated = validateFile(r.file);
      const key = 'sf-' + randomUUID(),
        temp = path.join(storage, key + '.tmp'),
        dest = path.join(storage, key);
      await fs.mkdir(storage, { recursive: true });
      try {
        await fs.writeFile(temp, r.file.buffer, { flag: 'wx' });
        await fs.rename(temp, dest);
        const file = await db.$transaction(async (tx) => {
          const { file: f, admin } = await fileAccess(tx, r, true);
          assert(
            path.extname(f.name).toLowerCase() ===
              path.extname(validated.name).toLowerCase(),
            '新版本须保留原文件类型',
          );
          const updated = await append(tx, r, f, input, {
            key,
            mime: validated.mime,
            size: r.file!.size,
          });
          return visible(updated, admin, r.user.id);
        });
        s.status(201).json(file);
      } catch (e) {
        await fs.rm(temp, { force: true });
        await fs.rm(dest, { force: true });
        throw e;
      }
    }),
  );
  router.post(
    '/space-files/:id/revisions/:number/restore',
    wrap(async (r, s) => {
      const number = z.coerce.number().int().positive().parse(r.params.number),
        input = z
          .object({
            expectedVersion: z.number().int().positive(),
            summary: z.string().trim().min(1).max(2000),
          })
          .strict()
          .parse(r.body);
      const file = await db.$transaction(async (tx) => {
        const { file: f, admin } = await fileAccess(tx, r, true);
        const old = await tx.spaceFileRevision.findUnique({
          where: { fileId_number: { fileId: f.id, number } },
        });
        assert(old, '版本不存在', 404);
        const updated = await append(
          tx,
          r,
          f,
          { ...input, summary: `恢复V${number}：${input.summary}` },
          { key: old.key, mime: old.mime, size: old.size },
        );
        return visible(updated, admin, r.user.id);
      });
      s.status(201).json(file);
    }),
  );
}
