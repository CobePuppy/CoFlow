import { runtimeConfig } from '../config/runtime.js';

import 'dotenv/config';
import 'reflect-metadata';

import { Prisma, PrismaClient } from '@prisma/client';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { createHash, timingSafeEqual } from 'node:crypto';

import { type Member, type Task } from '@coflow/contracts/index.js';
import { z } from 'zod';
import { assert } from '../modules/requirements/domain.js';

const db = new PrismaClient();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const origin = runtimeConfig.origin;
const storage = runtimeConfig.storage;
function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
}
type AuthRequest = Request & { user?: any; session?: any; requestId?: string };
const wrap =
  (fn: (r: AuthRequest, s: Response) => Promise<any>) =>
  (r: Request, s: Response, n: NextFunction) => {
    Promise.resolve(fn(r, s)).catch(n);
  };
async function projectWrite(
  tx: any,
  r: AuthRequest,
  id: string,
  allowAdmin = false,
) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`;
  const p = await tx.project.findUnique({ where: { id } });
  assert(p, '资源不存在', 404);
  assert(
    await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
      },
    }),
    '资源不存在',
    404,
  );
  const m = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId: id, userId: r.user.id } },
  });
  assert(
    m ||
      (allowAdmin &&
        (
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: p.workspaceId,
                userId: r.user.id,
              },
            },
          })
        )?.role === 'ADMIN'),
    '不是项目成员',
    403,
  );
  assert(!p.archivedAt, '项目已归档，只能读取', 409);
  return { ...p, member: m };
}
async function workspace(r: AuthRequest, id: string, admin = false) {
  const m = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: id, userId: r.user.id } },
  });
  assert(m, '资源不存在', 404);
  if (admin) assert(m.role === 'ADMIN', '需要团队管理员权限', 403);
  return m;
}
async function project(
  r: AuthRequest,
  id: string,
  write = false,
  allowAdmin = false,
) {
  const p = await db.project.findUnique({ where: { id } });
  assert(p, '资源不存在', 404);
  await workspace(r, p.workspaceId);
  const m = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: id, userId: r.user.id } },
  });
  assert(
    m || (allowAdmin && (await workspace(r, p.workspaceId)).role === 'ADMIN'),
    '不是项目成员',
    403,
  );
  if (write) assert(!p.archivedAt, '项目已归档，只能读取', 409);
  return { ...p, member: m };
}
async function task(
  r: AuthRequest,
  id: string,
  write = false,
  omitComments = false,
) {
  const t =
    omitComments && !write
      ? (
          await db.$queryRaw<any[]>(
            Prisma.sql`SELECT id,"workspaceId","projectId",number,status,version,"deletedAt","deletedBy","createdAt","updatedAt", (data - 'comments') || '{"comments":[]}'::jsonb AS data FROM "Task" WHERE id=${id}`,
          )
        )[0]
      : await db.task.findUnique({ where: { id } });
  assert(t, '资源不存在', 404);
  await project(r, t.projectId, write);
  if (write) assert(!t.deletedAt, '需求已移入回收站，请先恢复', 409);
  return t;
}
async function members(id: string): Promise<Member[]> {
  const p = await db.project.findUniqueOrThrow({ where: { id } });
  const teamMembers = await db.workspaceMember.findMany({
    where: { workspaceId: p.workspaceId },
  });
  const ms = await db.projectMember.findMany({ where: { projectId: id } }),
    users = await db.user.findMany({
      where: { id: { in: ms.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
  return users.map((u) => ({
    ...u,
    name: teamMembers.find((m) => m.userId === u.id)?.displayName || u.name,
    roles: ms.find((m) => m.userId === u.id)!.roles as any,
  }));
}
const asTask = (t: any): Task => ({
  ...t,
  createdAt: new Date(t.createdAt).toISOString(),
  updatedAt: new Date(t.updatedAt).toISOString(),
});
const page = (r: Request) =>
  z
    .object({
      page: z.coerce.number().int().min(1).max(1000000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(r.query);
async function record(
  tx: any,
  r: AuthRequest,
  wid: string,
  id: string,
  action: string,
) {
  await tx.auditEvent.create({
    data: { workspaceId: wid, resourceId: id, actorId: r.user.id, action },
  });
}
async function save(r: AuthRequest, t: any, data: any) {
  const expected = z.number().int().positive().parse(r.body.expectedVersion);
  assert(expected === t.version, '版本冲突，请保留输入并刷新', 409);
  return db.$transaction(async (tx) => {
    await projectWrite(tx, r, t.projectId);
    const result = await tx.task.updateMany({
      where: { id: t.id, version: expected, deletedAt: null },
      data: { data, version: { increment: 1 } },
    });
    assert(result.count, '数据已更新，请刷新；您的输入可以复制保留', 409);
    await record(tx, r, t.workspaceId, t.id, 'EDIT');
    return tx.task.findUnique({ where: { id: t.id } });
  });
}
function installSession(router: express.Router) {
  router.use((r: AuthRequest, s, n) => {
    (async () => {
      const cookie = r.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('coflow='))
        ?.slice(7);
      assert(cookie, '请先登录', 401);
      const session = await db.session.findUnique({
        where: { hash: hash(cookie) },
      });
      assert(
        session && session.expiresAt.getTime() > Date.now(),
        '会话已失效，请重新登录',
        401,
      );
      r.session = session;
      r.user = await db.user.findUnique({ where: { id: session.userId } });
      assert(r.user, '会话无效', 401);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method)) {
        assert(r.headers.origin === origin, 'Origin 校验失败', 403);
        const token = String(r.headers['x-csrf-token'] || '');
        assert(
          /^[a-f0-9]{48}$/.test(token) &&
            timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf)),
          'CSRF 校验失败',
          403,
        );
      }
      n();
    })().catch(n);
  });
}
export {
  asTask,
  canonical,
  db,
  hash,
  installSession,
  members,
  origin,
  page,
  project,
  projectWrite,
  record,
  save,
  storage,
  task,
  workspace,
  wrap,
};
export type { AuthRequest };
