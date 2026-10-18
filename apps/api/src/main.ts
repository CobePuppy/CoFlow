import { isOverdue } from '../../../packages/contracts/deadline.js';
import { canDeleteRequirement } from '../../../packages/contracts/task-deletion.js';
import {
  attachmentStage,
  attachmentVersion,
  attachmentList,
  installAttachmentRoutes,
} from './attachments.js';
import { installQualityRoutes } from './ai-quality.js';
import { installProofRoutes } from './proofloop.js';
import { installForkRoutes } from './forks.js';
import { encryptKey, decryptKey, encryptionReady } from './settings.js';
import {
  firstStepRunSchema,
  firstStepBriefSchema,
  firstStepBundleSchema,
  firstStepCredentials,
  generateFirstStep,
  verifyFirstStepKey,
  withFirstStepLimit,
} from './firststep.js';
import {
  firstStepMessages,
  firstStepSections,
} from '../../../packages/contracts/firststep.js';
import { competitionInput } from './competitions.js';
import { templateInputSchema } from './templates.js';
import 'reflect-metadata';
import 'dotenv/config';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { PrismaClient, type Prisma } from '@prisma/client';
import argon2 from 'argon2';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import multer from 'multer';
import { z } from 'zod';
import {
  BusinessError,
  assert,
  required,
  execute,
  handlers,
  metrics,
  validateOwners,
  allowedActions,
} from './domain.js';
import {
  actions,
  terminal,
  type Task,
  type Member,
} from '../../../packages/contracts/index.js';
import { validateFile } from './storage.js';
import { parsePayload } from './validation.js';
import { createQQRoutes } from './qq.js';
dotenv.config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});
export const db = new PrismaClient();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const storage = path.resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
  process.env.STORAGE_DIR || 'storage',
);
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
const router = express.Router();
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
async function task(r: AuthRequest, id: string, write = false) {
  const t = await db.task.findUnique({ where: { id } });
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
async function validateDraftOwners(projectId: string, d: any) {
  const people = await members(projectId);
  const needed: Record<string, string[]> = {
    productId: ['PRODUCT'],
    engineerId: ['ENGINEER'],
    productReviewerId: ['PRODUCT'],
    qaReviewerId: ['QA'],
    testerId: ['QA', 'OPS'],
  };
  assert(d.productId, '草稿必须指定产品负责人');
  for (const [key, roles] of Object.entries(needed))
    if (d[key])
      assert(
        people.some((m) => m.id === d[key]),
        `${key} 必须属于当前项目`,
      );
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
router.get(
  '/health',
  wrap(async (_r, s) => {
    await db.$queryRaw`SELECT 1`;
    s.json({ ok: true });
  }),
);
const attempts = new Map<string, { count: number; until: number }>();
const registrationAttempts = new Map<
  string,
  { count: number; until: number }
>();
router.post(
  '/auth/register',
  wrap(async (r, s) => {
    assert(r.headers.origin === origin, 'Origin 校验失败', 403);
    for (const [key, value] of registrationAttempts)
      if (value.until < Date.now()) registrationAttempts.delete(key);
    const key = r.ip || 'local';
    if (!registrationAttempts.has(key))
      registrationAttempts.set(key, { count: 0, until: Date.now() + 900000 });
    const attempt = registrationAttempts.get(key)!;
    assert(attempt.count++ < 20, '注册尝试过多，请稍后重试', 429);
    const input = z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('creator'),
          name: z.string().trim().min(1).max(80),
          email: z.string().trim().email().toLowerCase(),
          password: z.string().min(8).max(200),
          teamName: z.string().trim().min(1).max(100),
        }),
        z.object({
          kind: z.literal('member'),
          name: z.string().trim().min(1).max(80),
          email: z.string().trim().email().toLowerCase(),
          password: z.string().min(8).max(200),
          teamCode: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-F0-9]{12}$/),
        }),
      ])
      .parse(r.body);
    const password = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const result = await db.$transaction(async (tx) => {
      assert(
        !(await tx.user.findUnique({ where: { email: input.email } })),
        '该邮箱已注册，请直接登录',
        409,
      );
      let team;
      let teamCode: string | undefined;
      if (input.kind === 'creator') {
        team = await tx.workspace.create({ data: { name: input.teamName } });
        teamCode = randomBytes(6).toString('hex').toUpperCase();
        await tx.teamCode.create({
          data: { workspaceId: team.id, code: teamCode },
        });
      } else {
        const code = await tx.teamCode.findUnique({
          where: { code: input.teamCode },
        });
        assert(code, '团队码无效，请向团队创建者确认', 422);
        team = await tx.workspace.findUnique({
          where: { id: code.workspaceId },
        });
        assert(team, '团队码无效，请向团队创建者确认', 422);
      }
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, password },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: team.id,
          userId: user.id,
          role: input.kind === 'creator' ? 'ADMIN' : 'MEMBER',
        },
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: team.id,
          resourceId: team.id,
          actorId: user.id,
          action:
            input.kind === 'creator' ? 'TEAM_REGISTER' : 'TEAM_CODE_REGISTER',
        },
      });
      return { workspaceId: team.id, workspaceName: team.name, teamCode };
    });
    s.status(201).json(result);
  }),
);
router.get(
  '/invitations/:token/preview',
  wrap(async (r, s) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(r.params.token);
    const i = await db.invitation.findUnique({ where: { hash: hash(token) } });
    assert(
      i && !i.acceptedAt && i.expiresAt.getTime() > Date.now(),
      '邀请无效或已过期',
      404,
    );
    const w = await db.workspace.findUnique({ where: { id: i.workspaceId } });
    s.json({ email: i.email, workspaceName: w?.name, expiresAt: i.expiresAt });
  }),
);
router.post(
  '/auth/register-invitation',
  wrap(async (r, s) => {
    assert(r.headers.origin === origin, 'Origin 校验失败', 403);
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        name: z.string().trim().min(1).max(80),
        password: z.string().min(8).max(200),
      })
      .parse(r.body);
    const password = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const result = await db.$transaction(async (tx) => {
      const i = await tx.invitation.findUnique({
        where: { hash: hash(input.token) },
      });
      assert(
        i && !i.acceptedAt && i.expiresAt.getTime() > Date.now(),
        '邀请无效或已过期',
        422,
      );
      assert(
        !(await tx.user.findUnique({ where: { email: i.email } })),
        '该邮箱已有账号，请登录后接受邀请',
        409,
      );
      const claimed = await tx.invitation.updateMany({
        where: { id: i.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      assert(claimed.count, '邀请已使用或过期', 409);
      const u = await tx.user.create({
        data: { name: input.name, email: i.email, password },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: i.workspaceId, userId: u.id, role: 'MEMBER' },
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: i.workspaceId,
          resourceId: i.id,
          actorId: u.id,
          action: 'INVITATION_REGISTER',
        },
      });
      return { id: u.id, email: u.email, name: u.name };
    });
    s.json({ user: result });
  }),
);
router.post(
  '/auth/login',
  wrap(async (r, s) => {
    assert(r.headers.origin === origin, 'Origin 校验失败', 403);
    for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
    const key = r.ip || 'local',
      a = attempts.get(key);
    if (a && a.until > Date.now())
      assert(a.count < 20, '登录尝试过多，请稍后重试', 429);
    else attempts.set(key, { count: 0, until: Date.now() + 900000 });
    attempts.get(key)!.count++;
    const input = z
      .object({ email: z.email(), password: z.string().min(1).max(200) })
      .parse(r.body);
    const u = await db.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    assert(
      u && (await argon2.verify(u.password, input.password)),
      '邮箱或密码错误',
      401,
    );
    attempts.delete(key);
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    await db.session.create({
      data: {
        hash: hash(token),
        userId: u.id,
        csrf,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    s.cookie('coflow', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        process.env.COOKIE_SECURE === undefined
          ? process.env.NODE_ENV === 'production'
          : process.env.COOKIE_SECURE === 'true',
      maxAge: 86400000,
      path: '/',
    });
    s.json({ user: { id: u.id, name: u.name, email: u.email }, csrf });
  }),
);
const qqRoutes = createQQRoutes(db);
router.use('/integrations/qq', qqRoutes.bot);
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
router.use(qqRoutes.account);
router.get(
  '/auth/me',
  wrap(async (r, s) =>
    s.json({
      user: { id: r.user.id, name: r.user.name, email: r.user.email },
      csrf: r.session.csrf,
    }),
  ),
);
async function savedCredentials(userId: string) {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  assert(settings?.encryptedKey, '请先在个人设置中保存DeepSeek API Key', 422);
  return {
    apiKey: decryptKey(settings.encryptedKey, userId),
    model: settings.model as 'deepseek-flash' | 'deepseek-v4-pro',
  };
}
async function settingsView(userId: string) {
  const v = await db.userSettings.findUnique({ where: { userId } });
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return {
    ...user,
    model: v?.model || 'deepseek-flash',
    slides: v?.slides ?? 12,
    minutes: v?.minutes ?? 8,
    preferredEdition: v?.preferredEdition || 'student',
    version: v?.version ?? 0,
    hasKey: !!v?.encryptedKey,
    keyHint: v?.keyHint || '',
    encryptionReady: encryptionReady(),
  };
}
router.get(
  '/settings',
  wrap(async (r, s) => {
    s.setHeader('Cache-Control', 'no-store');
    s.json(await settingsView(r.user.id));
  }),
);
router.patch(
  '/settings',
  wrap(async (r, s) => {
    const input = z
      .object({
        expectedVersion: z.number().int().min(0),
        name: z.string().trim().min(1).max(100),
        model: firstStepCredentials.shape.model,
        slides: z.number().int().min(5).max(30),
        minutes: z.number().int().min(3).max(30),
        preferredEdition: z.enum(['student', 'enterprise']),
        apiKey: firstStepCredentials.shape.apiKey.optional(),
        removeKey: z.boolean().optional(),
      })
      .strict()
      .parse(r.body);
    assert(!(input.apiKey && input.removeKey), '不能同时替换和删除Key');
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${r.user.id} FOR UPDATE`;
      const previous = await tx.userSettings.findUnique({
        where: { userId: r.user.id },
      });
      assert(
        (previous?.version ?? 0) === input.expectedVersion,
        '设置已在其他页面修改，请刷新后重试',
        409,
      );
      const { expectedVersion, apiKey, removeKey, name, ...preferences } =
        input;
      const data = {
        ...preferences,
        version: expectedVersion + 1,
        ...(apiKey
          ? {
              encryptedKey: encryptKey(apiKey, r.user.id),
              keyHint: '••••' + apiKey.slice(-4),
            }
          : {}),
        ...(removeKey ? { encryptedKey: null, keyHint: null } : {}),
      };
      await tx.userSettings.upsert({
        where: { userId: r.user.id },
        create: { userId: r.user.id, ...data },
        update: data,
      });
      await tx.user.update({ where: { id: r.user.id }, data: { name } });
    });
    s.setHeader('Cache-Control', 'no-store');
    s.json(await settingsView(r.user.id));
  }),
);
router.post(
  '/settings/ai/verify',
  wrap(async (r, s) => {
    z.object({}).strict().parse(r.body);
    const c = await savedCredentials(r.user.id);
    s.setHeader('Cache-Control', 'no-store');
    s.json(
      await withFirstStepLimit(r.user.id, () =>
        verifyFirstStepKey(c.apiKey, c.model),
      ),
    );
  }),
);
router.post(
  '/settings/password',
  wrap(async (r, s) => {
    const input = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(12).max(200),
      })
      .strict()
      .parse(r.body);
    const password = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${r.user.id} FOR UPDATE`;
      const u = await tx.user.findUniqueOrThrow({ where: { id: r.user.id } });
      assert(
        await argon2.verify(u.password, input.currentPassword),
        '当前密码不正确',
        422,
      );
      await tx.user.update({ where: { id: r.user.id }, data: { password } });
      await tx.session.deleteMany({
        where: { userId: r.user.id, hash: { not: r.session.hash } },
      });
    });
    s.json({ ok: true });
  }),
);
router.post(
  '/auth/logout',
  wrap(async (r, s) => {
    await db.session.delete({ where: { hash: r.session.hash } });
    s.clearCookie('coflow', { path: '/' }).json({ ok: true });
  }),
);
router.get(
  '/workspaces',
  wrap(async (r, s) => {
    const ms = await db.workspaceMember.findMany({
      where: { userId: r.user.id },
    });
    const teams = await db.workspace.findMany({
      where: { id: { in: ms.map((m) => m.workspaceId) } },
    });
    s.json(
      teams.map((team) => ({
        ...team,
        role: ms.find((m) => m.workspaceId === team.id)!.role,
      })),
    );
  }),
);
router.post(
  '/workspaces',
  wrap(async (r, s) => {
    const name = z.string().trim().min(1).max(100).parse(r.body.name);
    s.json(
      await db.$transaction(async (tx) => {
        const w = await tx.workspace.create({ data: { name } });
        await tx.workspaceMember.create({
          data: { workspaceId: w.id, userId: r.user.id, role: 'ADMIN' },
        });
        await record(tx, r, w.id, w.id, 'TEAM_CREATE');
        return { ...w, role: 'ADMIN' };
      }),
    );
  }),
);
router.post(
  '/workspaces/join',
  wrap(async (r, s) => {
    const teamCode = z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-F0-9]{12}$/, '请输入有效的12位团队码')
      .parse(r.body.teamCode);
    const result = await db.$transaction(async (tx) => {
      const code = await tx.teamCode.findUnique({ where: { code: teamCode } });
      assert(code, '团队码无效，请向管理员确认', 422);
      const team = await tx.workspace.findUnique({
        where: { id: code.workspaceId },
      });
      assert(team, '团队不存在', 404);
      const membership = await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: team.id, userId: r.user.id },
        },
        create: { workspaceId: team.id, userId: r.user.id, role: 'MEMBER' },
        update: {},
      });
      await record(tx, r, team.id, team.id, 'TEAM_CODE_JOIN');
      return { ...team, role: membership.role };
    });
    s.json(result);
  }),
);
router.get(
  '/workspaces/:id/team-code',
  wrap(async (r, s) => {
    const id = String(r.params.id);
    await workspace(r, id, true);
    const code = await db.teamCode.upsert({
      where: { workspaceId: id },
      create: {
        workspaceId: id,
        code: randomBytes(6).toString('hex').toUpperCase(),
      },
      update: {},
    });
    s.json({ teamCode: code.code });
  }),
);
router.get(
  '/workspaces/:id/members',
  wrap(async (r, s) => {
    await workspace(r, String(r.params.id));
    const ms = await db.workspaceMember.findMany({
      where: { workspaceId: String(r.params.id) },
    });
    const us = await db.user.findMany({
      where: { id: { in: ms.map((m) => m.userId) } },
      select: { id: true, email: true, name: true },
    });
    s.json(
      us.map((u) => ({
        ...u,
        accountName: u.name,
        name: ms.find((m) => m.userId === u.id)!.displayName || u.name,
        displayName: ms.find((m) => m.userId === u.id)!.displayName,
        role: ms.find((m) => m.userId === u.id)!.role,
      })),
    );
  }),
);
router.patch(
  '/workspaces/:id/members',
  wrap(async (r, s) => {
    const id = String(r.params.id);
    await workspace(r, id, true);
    const role = z.enum(['ADMIN', 'MEMBER']).parse(r.body.role);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
      const admin = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: r.user.id } },
      });
      assert(admin?.role === 'ADMIN', '需要团队管理员权限', 403);
      const current = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: id, userId: r.body.userId },
        },
      });
      assert(current, '成员不存在', 404);
      if (current.role === 'ADMIN' && role !== 'ADMIN')
        assert(
          (await tx.workspaceMember.count({
            where: { workspaceId: id, role: 'ADMIN' },
          })) > 1,
          '必须保留至少一位管理员',
        );
      await tx.workspaceMember.update({
        where: {
          workspaceId_userId: { workspaceId: id, userId: r.body.userId },
        },
        data: { role },
      });
      await record(tx, r, id, id, 'MEMBER_ROLE');
    });
    s.json({ ok: true });
  }),
);
router.patch(
  '/workspaces/:id',
  wrap(async (r, s) => {
    const id = String(r.params.id);
    const data = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(r.body);
    await workspace(r, id, true);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
      assert(
        (
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: id, userId: r.user.id },
            },
          })
        )?.role === 'ADMIN',
        '需要团队管理员权限',
        403,
      );
      await tx.workspace.update({ where: { id }, data });
      await record(tx, r, id, id, 'TEAM_UPDATE');
    });
    s.json({ ok: true });
  }),
);
router.get(
  '/workspaces/:id/members/:userId/projects',
  wrap(async (r, s) => {
    const id = String(r.params.id),
      userId = String(r.params.userId);
    await workspace(r, id, true);
    const projects = await db.project.findMany({
      where: { workspaceId: id },
      orderBy: { name: 'asc' },
    });
    const assignments = await db.projectMember.findMany({
      where: { userId, projectId: { in: projects.map((p) => p.id) } },
    });
    s.json(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        archivedAt: p.archivedAt,
        roles: assignments.find((m) => m.projectId === p.id)?.roles || [],
      })),
    );
  }),
);
router.post(
  '/workspaces/:id/members/:userId/move',
  wrap(async (r, s) => {
    const id = String(r.params.id),
      userId = String(r.params.userId);
    const data = z
      .object({
        sourceId: z.string().optional(),
        targetId: z.string().min(1),
        roles: z.array(z.enum(['PRODUCT', 'ENGINEER', 'QA', 'OPS'])).min(1),
      })
      .strict()
      .parse(r.body);
    assert(data.sourceId !== data.targetId, '请选择不同的目标项目');
    await workspace(r, id, true);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
      assert(
        (
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: id, userId: r.user.id },
            },
          })
        )?.role === 'ADMIN',
        '需要团队管理员权限',
        403,
      );
      assert(
        await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: id, userId } },
        }),
        '成员不存在',
        404,
      );
      // The same project locks are used by requirement mutations and project membership writes.
      const ids = [
        data.targetId,
        ...(data.sourceId ? [data.sourceId] : []),
      ].sort();
      for (const projectId of ids)
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      for (const projectId of ids) {
        const p = await tx.project.findUnique({ where: { id: projectId } });
        assert(p?.workspaceId === id, '项目不属于当前团队', 404);
        assert(!p.archivedAt, '项目已归档，只能读取', 409);
      }
      if (data.sourceId) {
        assert(
          await tx.projectMember.findUnique({
            where: { projectId_userId: { projectId: data.sourceId, userId } },
          }),
          '成员不在来源项目中',
          409,
        );
        const tasks = await tx.task.findMany({
          where: {
            projectId: data.sourceId,
            status: { notIn: ['CLOSED', 'CANCELLED'] },
          },
        });
        assert(
          !tasks.some((t) =>
            [
              'productId',
              'engineerId',
              'testerId',
              'productReviewerId',
              'qaReviewerId',
            ].some((key) => (t.data as any)[key] === userId),
          ),
          '请先转交来源项目中未结束需求的责任（包括回收站中的需求）',
          409,
        );
        await tx.projectMember.delete({
          where: { projectId_userId: { projectId: data.sourceId, userId } },
        });
      }
      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId: data.targetId, userId } },
      });
      const roles = [...new Set([...(existing?.roles || []), ...data.roles])];
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: data.targetId, userId } },
        create: { projectId: data.targetId, userId, roles },
        update: { roles },
      });
      await record(tx, r, id, userId, 'MEMBER_PROJECT_MOVE');
    });
    s.json({ ok: true });
  }),
);
router.patch(
  '/workspaces/:id/members/:userId',
  wrap(async (r, s) => {
    const id = String(r.params.id),
      userId = String(r.params.userId);
    const data = z
      .object({
        displayName: z.string().trim().max(80),
        role: z.enum(['ADMIN', 'MEMBER']).optional(),
      })
      .strict()
      .parse(r.body);
    await workspace(r, id, true);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
      assert(
        (
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: id, userId: r.user.id },
            },
          })
        )?.role === 'ADMIN',
        '需要团队管理员权限',
        403,
      );
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId } },
      });
      assert(member, '成员不存在', 404);
      if (member.role === 'ADMIN' && data.role === 'MEMBER')
        assert(
          (await tx.workspaceMember.count({
            where: { workspaceId: id, role: 'ADMIN' },
          })) > 1,
          '必须保留至少一位管理员',
          409,
        );
      const result = await tx.workspaceMember.updateMany({
        where: { workspaceId: id, userId },
        data: {
          displayName: data.displayName || null,
          ...(data.role ? { role: data.role } : {}),
        },
      });
      assert(result.count, '成员不存在', 404);
      await record(tx, r, id, userId, 'MEMBER_PROFILE');
    });
    s.json({ ok: true });
  }),
);
async function removeTeamMember(
  tx: Prisma.TransactionClient,
  r: AuthRequest,
  id: string,
  userId: string,
) {
  assert(
    (
      await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: id, userId: r.user.id } },
      })
    )?.role === 'ADMIN',
    '需要团队管理员权限',
    403,
  );
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: id, userId } },
  });
  assert(member, '成员不存在', 404);
  if (member.role === 'ADMIN')
    assert(
      (await tx.workspaceMember.count({
        where: { workspaceId: id, role: 'ADMIN' },
      })) > 1,
      '必须保留至少一位管理员',
      409,
    );
  await tx.$queryRaw`SELECT id FROM "Project" WHERE "workspaceId" = ${id} ORDER BY id FOR UPDATE`;
  const tasks = await tx.task.findMany({
    where: { workspaceId: id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
  });
  const fields = [
    'productId',
    'engineerId',
    'testerId',
    'productReviewerId',
    'qaReviewerId',
  ];
  assert(
    !tasks.some((t: any) => fields.some((field) => t.data[field] === userId)),
    '请先转交未结束需求的责任（包括回收站中的需求），再移出团队',
    409,
  );
  const projects = await tx.project.findMany({
    where: { workspaceId: id },
    select: { id: true },
  });
  await tx.projectMember.deleteMany({
    where: { projectId: { in: projects.map((p: any) => p.id) }, userId },
  });
  await tx.qQBinding.deleteMany({ where: { workspaceId: id, userId } });
  await tx.qQBindingCode.deleteMany({ where: { workspaceId: id, userId } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  await tx.invitation.deleteMany({
    where: { workspaceId: id, email: user.email, acceptedAt: null },
  });
  await tx.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: id, userId } },
  });
  await record(tx, r, id, userId, 'MEMBER_REMOVE');
  return member;
}
router.get(
  '/workspaces/:id/member-transfer-targets',
  wrap(async (r, s) => {
    const id = String(r.params.id);
    await workspace(r, id, true);
    const memberships = await db.workspaceMember.findMany({
      where: { userId: r.user.id, role: 'ADMIN', workspaceId: { not: id } },
    });
    s.json(
      await db.workspace.findMany({
        where: { id: { in: memberships.map((m) => m.workspaceId) } },
        select: { id: true, name: true },
      }),
    );
  }),
);
router.post(
  '/workspaces/:id/members/:userId/transfer',
  wrap(async (r, s) => {
    const id = String(r.params.id),
      userId = String(r.params.userId);
    const { targetWorkspaceId } = z
      .object({ targetWorkspaceId: z.string().min(1) })
      .strict()
      .parse(r.body);
    assert(targetWorkspaceId !== id, '请选择其他团队');
    await workspace(r, id, true);
    await workspace(r, targetWorkspaceId, true);
    await db.$transaction(async (tx) => {
      for (const wid of [id, targetWorkspaceId].sort())
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${wid} FOR UPDATE`;
      assert(
        (
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: targetWorkspaceId,
                userId: r.user.id,
              },
            },
          })
        )?.role === 'ADMIN',
        '需要目标团队管理员权限',
        403,
      );
      const member = await removeTeamMember(tx, r, id, userId);
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: targetWorkspaceId, userId },
        },
        create: {
          workspaceId: targetWorkspaceId,
          userId,
          role: 'MEMBER',
          displayName: member.displayName,
        },
        update: {},
      });
      await record(tx, r, id, userId, 'MEMBER_TRANSFER_OUT');
      await record(tx, r, targetWorkspaceId, userId, 'MEMBER_TRANSFER_IN');
    });
    s.json({ ok: true });
  }),
);
router.delete(
  '/workspaces/:id/members/:userId',
  wrap(async (r, s) => {
    const id = String(r.params.id),
      userId = String(r.params.userId);
    await workspace(r, id, true);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
      await removeTeamMember(tx, r, id, userId);
    });
    s.json({ ok: true });
  }),
);
router.post(
  '/workspaces/:id/invitations',
  wrap(async (r, s) => {
    const id = String(r.params.id);
    await workspace(r, id, true);
    const email = z.email().parse(r.body.email).toLowerCase(),
      token = randomBytes(32).toString('hex');
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${id} FOR UPDATE`;
      assert(
        (
          await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: id, userId: r.user.id },
            },
          })
        )?.role === 'ADMIN',
        '需要团队管理员权限',
        403,
      );
      const invitation = await tx.invitation.create({
        data: {
          workspaceId: id,
          email,
          hash: hash(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await record(tx, r, id, invitation.id, 'INVITATION_CREATE');
    });
    s.json({ url: `${origin}/?invite=${token}`, expiresInDays: 7 });
  }),
);
router.post(
  '/invitations/accept',
  wrap(async (r, s) => {
    const token = z.string().parse(r.body.token);
    await db.$transaction(async (tx) => {
      const pending = await tx.invitation.findUnique({
        where: { hash: hash(token) },
      });
      assert(pending, '邀请无效或已过期');
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${pending.workspaceId} FOR UPDATE`;
      const i = await tx.invitation.findUnique({
        where: { hash: hash(token) },
      });
      assert(
        i && !i.acceptedAt && i.expiresAt.getTime() > Date.now(),
        '邀请无效或已过期',
      );
      assert(i.email === r.user.email, '邀请邮箱与当前账号不一致', 403);
      const updated = await tx.invitation.updateMany({
        where: { id: i.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      assert(updated.count, '邀请已使用', 409);
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: i.workspaceId, userId: r.user.id },
        },
        create: {
          workspaceId: i.workspaceId,
          userId: r.user.id,
          role: 'MEMBER',
        },
        update: {},
      });
      await record(tx, r, i.workspaceId, i.id, 'INVITATION_ACCEPT');
    });
    s.json({ ok: true });
  }),
);
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
              ? { description: z.string().max(10000).parse(r.body.description) }
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
      ]);
      assert(
        counts.every((n) => n === 0),
        '项目仍有需求、文档、附件、竞赛、模板或分身，请先归档保留数据；仅空项目可永久删除',
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
  '/workspaces/:id/overview',
  wrap(async (r, s) => {
    const wid = String(r.params.id);
    await workspace(r, wid);
    const memberships = await db.projectMember.findMany({
      where: { userId: r.user.id },
    });
    const projects = await db.project.findMany({
      where: {
        workspaceId: wid,
        id: { in: memberships.map((m) => m.projectId) },
      },
    });
    const ids = projects.filter((p) => !p.archivedAt).map((p) => p.id);
    const tasks = await db.task.findMany({
      where: {
        projectId: { in: ids },
        status: { notIn: ['CLOSED', 'CANCELLED'] },
        deletedAt: null,
      },
    });
    const todos = tasks
      .map(asTask)
      .filter((t) => handlers(t).includes(r.user.id));
    const competitions = await db.competition.findMany({
      where: { workspaceId: wid, stage: { notIn: ['FINISHED'] } },
      orderBy: { updatedAt: 'desc' },
    });
    const documents = await db.document.findMany({
      where: { projectId: { in: ids } },
      select: { id: true, title: true, projectId: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    });
    s.json({
      projects: projects.map((p) => ({
        ...p,
        openTasks: tasks.filter((t) => t.projectId === p.id).length,
      })),
      todos,
      competitions,
      documents,
    });
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
          where: { workspaceId_userId: { workspaceId: p.workspaceId, userId } },
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
router.delete(
  '/projects/:id/members/:userId',
  wrap(async (r, s) => {
    const p = await project(r, String(r.params.id), true, true);
    await workspace(r, p.workspaceId, true);
    const userId = String(r.params.userId);
    await db.$transaction(async (tx) => {
      await projectWrite(tx, r, p.id, true);
      const tasks = await tx.task.findMany({
        where: { projectId: p.id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
      });
      assert(
        !tasks.some((t) =>
          [
            'productId',
            'engineerId',
            'productReviewerId',
            'qaReviewerId',
            'testerId',
          ].some((k) => (t.data as any)[k] === userId),
        ),
        '请先转交未结束任务的责任',
      );
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId: p.id, userId } },
      });
      await record(tx, r, p.workspaceId, p.id, 'PROJECT_MEMBER_REMOVE');
    });
    s.json({ ok: true });
  }),
);
async function templateAccess(
  r: AuthRequest,
  projectId: string,
  write = false,
) {
  const p = await project(r, projectId, write);
  const membership = await workspace(r, p.workspaceId);
  return {
    project: p,
    canManage:
      membership.role === 'ADMIN' || p.member?.roles.includes('PRODUCT'),
  };
}
async function templateWrite(tx: any, r: AuthRequest, projectId: string) {
  const p = await projectWrite(tx, r, projectId);
  const membership = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: p.workspaceId, userId: r.user.id },
    },
  });
  assert(
    membership?.role === 'ADMIN' || p.member?.roles.includes('PRODUCT'),
    '仅团队管理员或项目产品成员可管理模板',
    403,
  );
  return p;
}
router.post(
  '/competitions/:id/firststep/preview',
  wrap(async (r, s) => {
    const item = await db.competition.findUnique({
      where: { id: String(r.params.id) },
    });
    assert(item, '资源不存在', 404);
    await project(r, item.projectId);
    const brief = firstStepBriefSchema.parse(r.body.brief);
    s.setHeader('Cache-Control', 'no-store');
    s.json({
      messages: firstStepMessages(item, brief),
      sections: firstStepSections,
    });
  }),
);
router.post(
  '/competitions/:id/firststep/run',
  wrap(async (r, s) => {
    const item = await db.competition.findUnique({
      where: { id: String(r.params.id) },
    });
    assert(item, '资源不存在', 404);
    await project(r, item.projectId, true);
    const input = firstStepRunSchema.parse(r.body);
    const credentials = await savedCredentials(r.user.id);
    assert(
      item.version === input.expectedVersion,
      '竞赛信息已变化，请重新打开FirstStepAgent',
      409,
    );
    s.setHeader('Cache-Control', 'no-store');
    const result = await withFirstStepLimit(r.user.id, () =>
      generateFirstStep(item, input.brief, credentials.apiKey, input.model),
    );
    await db.$transaction(async (tx) => {
      await projectWrite(tx, r, item.projectId);
      const latest = await tx.competition.findUnique({
        where: { id: item.id },
      });
      assert(
        latest?.version === item.version,
        '竞赛信息已变化，生成结果未保存，请核对后重新生成',
        409,
      );
      await record(tx, r, item.workspaceId, item.id, 'FIRSTSTEP_GENERATE');
    });
    s.json({
      ...result,
      model: input.model,
      competitionVersion: item.version,
      generatedAt: new Date().toISOString(),
    });
  }),
);
router.post(
  '/competitions/:id/firststep/save',
  wrap(async (r, s) => {
    const item = await db.competition.findUnique({
      where: { id: String(r.params.id) },
    });
    assert(item, '资源不存在', 404);
    await project(r, item.projectId, true);
    const input = z
      .object({
        bundle: firstStepBundleSchema,
        expectedVersion: z.number().int().positive(),
        requestKey: z.uuid(),
      })
      .strict()
      .parse(r.body);
    const digest = hash(JSON.stringify(input));
    const saved = await db.$transaction(async (tx) => {
      await projectWrite(tx, r, item.projectId);
      const latest = await tx.competition.findUnique({
        where: { id: item.id },
      });
      assert(
        latest?.version === input.expectedVersion,
        '竞赛信息已变化，请核对后再保存',
        409,
      );
      const key = 'firststep-save:' + item.id + ':' + input.requestKey;
      const existing = await tx.idempotencyRecord.findUnique({
        where: { userId_key: { userId: r.user.id, key } },
      });
      if (existing) {
        assert(
          existing.digest === digest,
          '保存请求标识已被使用，请重新生成保存请求',
          409,
        );
        return existing.result;
      }
      const documents = [];
      for (const [section, label] of Object.entries(firstStepSections)) {
        let content = input.bundle[section as keyof typeof firstStepSections];
        if (section === 'analysis' && input.bundle.questions.length)
          content +=
            '\n\n## 待确认问题\n' +
            input.bundle.questions
              .map((question) => '- ' + question)
              .join('\n');
        content = '> FirstStepAgent生成草稿，尚未人工核对。\n\n' + content;
        const title = item.name.slice(0, 110) + ' · FirstStep · ' + label;
        const document = await tx.document.create({
          data: {
            projectId: item.projectId,
            workspaceId: item.workspaceId,
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
        await record(tx, r, item.workspaceId, document.id, 'DOCUMENT_CREATE');
        documents.push({ id: document.id, title });
      }
      await record(tx, r, item.workspaceId, item.id, 'FIRSTSTEP_SAVE');
      const result = { documents };
      await tx.idempotencyRecord.create({
        data: {
          userId: r.user.id,
          key,
          digest,
          result,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return result;
    });
    s.json(saved);
  }),
);
router.get(
  '/workspaces/:id/competitions',
  wrap(async (r, s) => {
    const workspaceId = String(r.params.id);
    const teamMember = await workspace(r, workspaceId);
    const canManageMembers = teamMember.role === 'ADMIN';
    const projects = await db.project.findMany({
      where: { workspaceId },
      select: { id: true, name: true, archivedAt: true },
    });
    const memberships = await db.projectMember.findMany({
      where: {
        userId: r.user.id,
        projectId: { in: projects.map((p) => p.id) },
      },
    });
    const accessible = new Set(memberships.map((m) => m.projectId));
    const items = await db.competition.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    s.setHeader('Cache-Control', 'no-store');
    s.json({
      projects: projects
        .filter((p) => accessible.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, readOnly: !!p.archivedAt })),
      items: items.map((item) => {
        const p = projects.find((p) => p.id === item.projectId);
        return {
          ...item,
          projectName: p?.name || '所属项目不可用',
          canAccessProject: accessible.has(item.projectId),
          readOnly:
            (!accessible.has(item.projectId) && !canManageMembers) ||
            !!p?.archivedAt,
          canManageMembers,
          archived: !!p?.archivedAt,
        };
      }),
    });
  }),
);
router.get(
  '/projects/:id/competitions',
  wrap(async (r, s) => {
    const p = await project(r, String(r.params.id));
    s.json({
      readOnly: !!p.archivedAt,
      items: await db.competition.findMany({
        where: { projectId: p.id },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    });
  }),
);
router.post(
  '/projects/:id/competitions',
  wrap(async (r, s) => {
    const p = await project(r, String(r.params.id), true),
      input = competitionInput.parse(r.body);
    s.json(
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, p.id);
        const item = await tx.competition.create({
          data: { ...input, projectId: p.id, workspaceId: p.workspaceId },
        });
        await record(tx, r, p.workspaceId, item.id, 'COMPETITION_CREATE');
        return item;
      }),
    );
  }),
);
router.patch(
  '/competitions/:id',
  wrap(async (r, s) => {
    const item = await db.competition.findUnique({
      where: { id: String(r.params.id) },
    });
    assert(item, '资源不存在', 404);
    await project(r, item.projectId, true, true);
    const input = competitionInput.parse(r.body);
    const expectedVersion = z
      .number()
      .int()
      .positive()
      .parse(r.body.expectedVersion);
    s.json(
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, item.projectId, true);
        const result = await tx.competition.updateMany({
          where: { id: item.id, version: expectedVersion },
          data: { ...input, version: { increment: 1 } },
        });
        assert(result.count, '竞赛记录已更新，请保留输入并刷新', 409);
        await record(tx, r, item.workspaceId, item.id, 'COMPETITION_UPDATE');
        return tx.competition.findUnique({ where: { id: item.id } });
      }),
    );
  }),
);
router.get(
  '/projects/:id/templates',
  wrap(async (r, s) => {
    const { project: p, canManage } = await templateAccess(
      r,
      String(r.params.id),
    );
    const items = await db.requirementTemplate.findMany({
      where: { projectId: p.id, ...(canManage ? {} : { active: true }) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    s.json({ items, canManage, readOnly: !!p.archivedAt });
  }),
);
router.post(
  '/projects/:id/templates',
  wrap(async (r, s) => {
    const { project: p } = await templateAccess(r, String(r.params.id), true);
    const input = templateInputSchema.parse(r.body);
    s.json(
      await db.$transaction(async (tx) => {
        await templateWrite(tx, r, p.id);
        const result = await tx.requirementTemplate.create({
          data: {
            ...input,
            projectId: p.id,
            workspaceId: p.workspaceId,
            createdBy: r.user.id,
          },
        });
        await record(tx, r, p.workspaceId, result.id, 'TEMPLATE_CREATE');
        return result;
      }),
    );
  }),
);
router.patch(
  '/templates/:id',
  wrap(async (r, s) => {
    const item = await db.requirementTemplate.findUnique({
      where: { id: String(r.params.id) },
    });
    assert(item, '资源不存在', 404);
    await templateAccess(r, item.projectId, true);
    const input = templateInputSchema.parse(r.body);
    const expectedVersion = z
      .number()
      .int()
      .positive()
      .parse(r.body.expectedVersion);
    s.json(
      await db.$transaction(async (tx) => {
        await templateWrite(tx, r, item.projectId);
        const result = await tx.requirementTemplate.updateMany({
          where: { id: item.id, version: expectedVersion },
          data: { ...input, version: { increment: 1 } },
        });
        assert(result.count, '模板已更新，请保留输入并刷新', 409);
        await record(tx, r, item.workspaceId, item.id, 'TEMPLATE_UPDATE');
        return tx.requirementTemplate.findUnique({ where: { id: item.id } });
      }),
    );
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
router.get(
  '/projects/:id/tasks',
  wrap(async (r, s) => {
    const projectInfo = await project(r, String(r.params.id));
    const teamMember = await workspace(r, projectInfo.workspaceId);
    const trash = r.query.scope === 'trash';
    let items = (
      await db.task.findMany({
        where: {
          projectId: String(r.params.id),
          deletedAt: trash ? { not: null } : null,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      })
    ).map(asTask);
    const scope = String(r.query.scope || (r.query.status ? 'all' : 'active'));
    if (scope === 'active') items = items.filter((t) => !terminal(t.status));
    if (scope === 'ended') items = items.filter((t) => terminal(t.status));
    if (scope === 'handling')
      items = items.filter(
        (t) => !terminal(t.status) && handlers(t).includes(r.user.id),
      );
    if (scope === 'mine')
      items = items.filter((t) =>
        [
          t.data.productId,
          t.data.engineerId,
          t.data.testerId,
          t.data.productReviewerId,
          t.data.qaReviewerId,
        ].includes(r.user.id),
      );
    if (scope === 'overdue')
      items = items.filter(
        (t) => !terminal(t.status) && isOverdue(t.data.dueAt),
      );
    for (const k of ['status', 'priority', 'blocked', 'owner', 'q']) {
      const v = String(r.query[k] || '');
      if (v)
        items = items.filter((t) =>
          k === 'status'
            ? t.status === v
            : k === 'priority'
              ? t.data.priority === v
              : k === 'blocked'
                ? t.data.blocks.some((b) => !b.end) === (v === 'true')
                : k === 'owner'
                  ? [
                      t.data.productId,
                      t.data.engineerId,
                      t.data.testerId,
                      t.data.productReviewerId,
                      t.data.qaReviewerId,
                    ].includes(v)
                  : `${t.data.title} ${t.data.description}`
                      .toLowerCase()
                      .includes(v.toLowerCase()),
        );
    }
    const p = page(r);
    s.json({
      ...p,
      total: items.length,
      canManage: teamMember.role === 'ADMIN',
      readOnly: !!projectInfo.archivedAt,
      items: items.slice((p.page - 1) * p.pageSize, p.page * p.pageSize),
    });
  }),
);
const draftSchema = z.object({
  title: z.string().min(1).max(200),
  background: z.string().max(10000).default(''),
  goal: z.string().max(10000).default(''),
  description: z.string().max(100000).default(''),
  criteria: z.array(z.string().max(2000)).max(100).default([]),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
  productId: z.string().default(''),
  engineerId: z.string().default(''),
  productReviewerId: z.string().default(''),
  qaReviewerId: z.string().default(''),
  testerId: z.string().default(''),
  dueAt: z.iso.datetime().optional(),
  type: z.enum(['REQUIREMENT', 'BUG']).default('REQUIREMENT'),
  severity: z.enum(['BLOCKER', 'MAJOR', 'MINOR']).optional(),
  parentId: z.string().optional(),
  parentRound: z.number().int().optional(),
});
installQualityRoutes(router, {
  db,
  wrap,
  task,
  project,
  projectWrite,
  record,
  savedCredentials,
});
installForkRoutes(router, { db, wrap, project, projectWrite, record });
installProofRoutes(router, {
  db,
  wrap,
  project,
  projectWrite,
  record,
  savedCredentials,
  draftSchema,
  validateDraftOwners,
});
router.post(
  '/projects/:id/tasks',
  wrap(async (r, s) => {
    const p = await project(r, String(r.params.id), true);
    assert(
      p.workflow === 'SIMPLE' ||
        p.member?.roles.some((x) => ['PRODUCT', 'QA', 'ENGINEER'].includes(x)),
      '无权创建任务',
      403,
    );
    const input = draftSchema.parse({
      ...r.body,
      productId: r.body.productId || r.user.id,
    });
    await validateDraftOwners(p.id, input);
    const submit = z.boolean().default(false).parse(r.body.submit);
    if (submit)
      assert(
        input.productId === r.user.id,
        '请以需求负责人身份提交，或保存草稿交给负责人',
        403,
      );
    if (input.type === 'BUG') {
      assert(
        input.parentId && input.severity && input.parentRound,
        '缺陷必须关联父任务及测试轮次',
      );
      const parent = await task(r, input.parentId);
      assert(
        parent.projectId === p.id &&
          (parent.data as any).tests.some(
            (t: any) => t.round === input.parentRound,
          ),
        '父任务或测试轮次无效',
      );
    } else assert(!input.parentId, '普通需求不能指定缺陷父任务');
    s.json(
      await db.$transaction(async (tx) => {
        await projectWrite(tx, r, p.id);
        await validateDraftOwners(p.id, input);
        const project = await tx.project.update({
          where: { id: p.id },
          data: { sequence: { increment: 1 } },
        });
        const created = await tx.task.create({
          data: {
            workspaceId: p.workspaceId,
            projectId: p.id,
            number: project.sequence,
            data: {
              ...input,
              workflow: p.workflow as 'SIMPLE' | 'STANDARD',
              createdBy: r.user.id,
              requirementVersion: 0,
              requirements: [],
              solutions: [],
              reviews: [],
              development: [],
              tests: [],
              acceptances: [],
              changes: [],
              blocks: [],
              comments: [],
              history: [],
            },
          },
        });
        if (!submit) return created;
        const people = await members(p.id);
        const next = execute(
          asTask(created),
          'SUBMIT_REQUIREMENT',
          {},
          people.find((m) => m.id === r.user.id)!,
          people,
        );
        const saved = await tx.task.update({
          where: { id: created.id },
          data: {
            status: next.status,
            version: next.version,
            data: next.data as any,
          },
        });
        await record(tx, r, p.workspaceId, created.id, 'SUBMIT_REQUIREMENT');
        if (input.engineerId && input.engineerId !== r.user.id)
          await tx.notification.create({
            data: {
              recipientId: input.engineerId,
              workspaceId: p.workspaceId,
              projectId: p.id,
              taskId: saved.id,
              message: next.data.title + '：待你处理',
              dedupe: saved.id + ':submit:' + input.engineerId,
            },
          });
        return saved;
      }),
    );
  }),
);
router.get(
  '/tasks/:id',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id));
    const people = await members(t.projectId);
    const p = await project(r, t.projectId);
    const isAdmin = (await workspace(r, t.workspaceId)).role === 'ADMIN';
    s.json({
      ...t,
      handlerIds: handlers(asTask(t)),
      readOnly: !!p.archivedAt || !!t.deletedAt,
      canManage: isAdmin,
      editableFields:
        !p.archivedAt &&
        !t.deletedAt &&
        !['CLOSED', 'CANCELLED'].includes(t.status) &&
        ((t.data as any).productId === r.user.id || isAdmin) &&
        people.some((m) => m.id === r.user.id)
          ? ['priority', 'dueAt']
          : [],
      allowedActions:
        p.archivedAt || t.deletedAt
          ? []
          : allowedActions(
              asTask(t),
              people.find((m) => m.id === r.user.id)!,
              isAdmin,
            ),
      attachments: await db.attachment.findMany({
        where: { taskId: t.id, deletedAt: null },
        select: {
          id: true,
          name: true,
          size: true,
          createdAt: true,
          stage: true,
          stageVersion: true,
        },
      }),
    });
  }),
);
router.patch(
  '/tasks/:id/properties',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id), true);
    const input = z
      .object({
        expectedVersion: z.number().int().positive(),
        priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
        dueAt: z.iso.datetime().nullable().optional(),
      })
      .strict()
      .parse(r.body);
    assert(
      input.priority !== undefined || input.dueAt !== undefined,
      '请选择需要修改的字段',
    );
    const result = await db.$transaction(async (tx) => {
      await projectWrite(tx, r, t.projectId);
      const fresh = await tx.task.findUnique({ where: { id: t.id } });
      assert(
        fresh && !fresh.deletedAt && fresh.version === input.expectedVersion,
        '版本冲突，请保留选择并刷新',
        409,
      );
      const data = fresh.data as any;
      const pm = await tx.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: t.projectId, userId: r.user.id },
        },
      });
      assert(
        !!pm &&
          (data.productId === r.user.id ||
            (
              await tx.workspaceMember.findUnique({
                where: {
                  workspaceId_userId: {
                    workspaceId: t.workspaceId,
                    userId: r.user.id,
                  },
                },
              })
            )?.role === 'ADMIN'),
        '仅需求负责人或团队管理员可修改基本信息',
        403,
      );
      assert(
        !['CLOSED', 'CANCELLED'].includes(fresh.status),
        '终态任务仅可查看',
        409,
      );
      const changes: Record<string, any> = {};
      if (input.priority !== undefined) {
        changes.priority = { from: data.priority, to: input.priority };
        data.priority = input.priority;
      }
      if (input.dueAt !== undefined) {
        changes.dueAt = { from: data.dueAt || null, to: input.dueAt };
        if (input.dueAt === null) delete data.dueAt;
        else data.dueAt = input.dueAt;
      }
      data.history.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: r.user.id,
        name: r.user.name,
        action: 'UPDATE_PROPERTIES',
        from: fresh.status,
        to: fresh.status,
        payload: { changes },
      });
      const updated = await tx.task.updateMany({
        where: { id: t.id, version: input.expectedVersion, deletedAt: null },
        data: { data, version: { increment: 1 } },
      });
      assert(updated.count, '版本冲突，请保留选择并刷新', 409);
      await record(tx, r, t.workspaceId, t.id, 'UPDATE_PROPERTIES');
      for (const uid of new Set([
        data.productId,
        data.engineerId,
        data.testerId,
      ]))
        if (uid && uid !== r.user.id)
          await tx.notification.create({
            data: {
              recipientId: uid,
              workspaceId: t.workspaceId,
              projectId: t.projectId,
              taskId: t.id,
              message: `${data.title}：基本信息已更新`,
              dedupe: `${t.id}:${fresh.version + 1}:${uid}`,
            },
          });
      return tx.task.findUnique({ where: { id: t.id } });
    });
    s.json(result);
  }),
);
router.patch(
  '/tasks/:id',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id), true),
      d = t.data as any;
    assert(t.status === 'DRAFT', '已提交需求只能通过变更流程修改', 409);
    assert(d.productId === r.user.id, '仅产品负责人可编辑', 403);
    assert(
      !('status' in r.body) && !('version' in r.body) && !('data' in r.body),
      '状态与内部版本只能通过业务动作修改',
    );
    const input = draftSchema.parse({ ...d, ...r.body });
    const targetId = z.string().parse(r.body.projectId || t.projectId);
    await validateDraftOwners(targetId, input);
    if (targetId !== t.projectId) {
      const target = await project(r, targetId, true);
      assert(target.workspaceId === t.workspaceId, '只能调整到同团队项目');
      assert(
        d.type !== 'BUG' && input.type !== 'BUG' && !input.parentId,
        '关联缺陷不能跨项目调整',
        409,
      );
      const expected = z
        .number()
        .int()
        .positive()
        .parse(r.body.expectedVersion);
      const moved = await db.$transaction(async (tx) => {
        for (const id of [t.projectId, targetId].sort())
          await projectWrite(tx, r, id);
        await validateDraftOwners(targetId, input);
        const latest = await tx.task.findUnique({ where: { id: t.id } });
        assert(
          latest?.version === expected &&
            !latest.deletedAt &&
            latest.status === 'DRAFT' &&
            (latest.data as any).productId === r.user.id,
          '版本冲突，请刷新',
          409,
        );
        assert(
          (latest.data as any).requirements.length === 0,
          '已提交过的需求不能调整所属项目',
          409,
        );
        const refs = await Promise.all([
          tx.attachment.count({ where: { taskId: t.id } }),
          tx.document.count({ where: { taskIds: { has: t.id } } }),
          tx.notification.count({ where: { taskId: t.id } }),
          tx.task.count({
            where: { data: { path: ['parentId'], equals: t.id } },
          }),
        ]);
        assert(
          refs.every((n) => n === 0),
          '需求已有关联材料、通知或缺陷，请先解除关联再调整项目',
          409,
        );
        const linkedPlans = [
          ...(await tx.proofBoard.findMany({
            where: { projectId: t.projectId },
            select: { data: true },
          })),
          ...(await tx.projectFork.findMany({
            where: { projectId: t.projectId },
            select: { data: true },
          })),
        ];
        assert(
          !linkedPlans.some((x) => JSON.stringify(x.data).includes(t.id)),
          '需求仍关联成果验证或项目分身，请先解除关联再调整项目',
          409,
        );
        const dest = await tx.project.update({
          where: { id: targetId },
          data: { sequence: { increment: 1 } },
        });
        const result = await tx.task.updateMany({
          where: { id: t.id, version: expected },
          data: {
            projectId: targetId,
            number: dest.sequence,
            data: { ...d, ...input },
            version: { increment: 1 },
          },
        });
        assert(result.count, '版本冲突', 409);
        await record(tx, r, t.workspaceId, t.id, 'DRAFT_PROJECT_CHANGE');
        return tx.task.findUnique({ where: { id: t.id } });
      });
      s.json(moved);
      return;
    }
    assert(
      input.parentId === d.parentId &&
        input.type === d.type &&
        input.parentRound === d.parentRound,
      '不能修改缺陷关联',
    );
    s.json(await save(r, t, { ...d, ...input }));
  }),
);
async function changeTrash(r: AuthRequest, restore: boolean) {
  const t = await task(r, String(r.params.id));
  const expected = z.number().int().positive().parse(r.body.expectedVersion);
  return db.$transaction(async (tx) => {
    await projectWrite(tx, r, t.projectId);
    const team = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: t.workspaceId, userId: r.user.id },
      },
    });
    const fresh = await tx.task.findUnique({ where: { id: t.id } });
    assert(fresh && fresh.version === expected, '版本冲突，请刷新后重试', 409);
    const d = fresh.data as any;
    assert(
      team?.role === 'ADMIN' ||
        d.productId === r.user.id ||
        d.createdBy === r.user.id,
      '仅创建人、需求负责人或团队管理员可管理回收站',
      403,
    );
    assert(
      restore ? !!fresh.deletedAt : !fresh.deletedAt,
      restore ? '需求不在回收站' : '需求已移入回收站',
      409,
    );
    const history = [
      ...d.history,
      {
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: r.user.id,
        name: r.user.name,
        action: restore ? 'TASK_RESTORE' : 'TASK_TRASH',
        from: fresh.status,
        to: fresh.status,
        payload: {},
      },
    ];
    const result = await tx.task.updateMany({
      where: { id: t.id, version: expected },
      data: {
        deletedAt: restore ? null : new Date(),
        deletedBy: restore ? null : r.user.id,
        version: { increment: 1 },
        data: { ...d, history },
      },
    });
    assert(result.count, '版本冲突', 409);
    await record(
      tx,
      r,
      t.workspaceId,
      t.id,
      restore ? 'TASK_RESTORE' : 'TASK_TRASH',
    );
    return { ok: true };
  });
}
router.delete(
  '/tasks/:id',
  wrap(async (r, s) => s.json(await changeTrash(r, false))),
);
router.post(
  '/tasks/:id/restore',
  wrap(async (r, s) => s.json(await changeTrash(r, true))),
);
router.delete(
  '/tasks/:id/permanent',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id));
    await db.$transaction(async (tx) => {
      await projectWrite(tx, r, t.projectId);
      const member = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: t.workspaceId, userId: r.user.id },
        },
      });
      assert(member?.role === 'ADMIN', '仅团队管理员可永久删除', 403);
      const fresh = await tx.task.findUnique({ where: { id: t.id } });
      assert(fresh?.deletedAt, '请先移入回收站', 409);
      assert(
        fresh.version ===
          z.number().int().positive().parse(r.body.expectedVersion),
        '版本冲突',
        409,
      );
      assert(
        r.body.confirmTitle === (fresh.data as any).title,
        '请输入需求标题确认永久删除',
      );
      assert(
        !(await tx.document.count({ where: { taskIds: { has: t.id } } })),
        '仍有文档引用，请保留回收站记录',
        409,
      );
      assert(
        !(await tx.task.count({
          where: { data: { path: ['parentId'], equals: t.id } },
        })),
        '仍有缺陷引用，请保留回收站记录',
        409,
      );
      const plans = [
        ...(await tx.proofBoard.findMany({
          where: { projectId: t.projectId },
          select: { data: true },
        })),
        ...(await tx.projectFork.findMany({
          where: { projectId: t.projectId },
          select: { data: true },
        })),
      ];
      assert(
        !plans.some((x) => JSON.stringify(x.data).includes(t.id)),
        '仍有成果验证或项目分身引用，请保留回收站记录',
        409,
      );
      await tx.notification.deleteMany({ where: { taskId: t.id } });
      await tx.attachment.deleteMany({ where: { taskId: t.id } });
      await tx.task.delete({ where: { id: t.id } });
      await record(tx, r, t.workspaceId, t.id, 'TASK_PURGE');
    });
    s.json({ ok: true });
  }),
);
const actionHandler = wrap(async (r, s) => {
  const t = await task(r, String(r.params.id), true);
  const input = z
    .object({
      action: z.enum(actions),
      expectedVersion: z.number().int().positive(),
      payload: z.record(z.string(), z.any()).default({}),
    })
    .parse(r.body);
  const key = z.string().min(8).max(200).parse(r.headers['idempotency-key']);
  const digest = hash(JSON.stringify(canonical({ id: t.id, ...input })));
  input.payload = parsePayload(input.action, input.payload);
  const result = await db.$transaction(async (tx) => {
    // Lock project before checking membership/archive to serialize administration and business writes.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${t.projectId} FOR UPDATE`;
    const p = await tx.project.findUnique({ where: { id: t.projectId } });
    assert(p && !p.archivedAt, '项目已归档', 409);
    const ms = await tx.projectMember.findMany({
      where: { projectId: t.projectId },
    });
    assert(
      ms.some((m) => m.userId === r.user.id),
      '不是项目成员',
      403,
    );
    const old = await tx.idempotencyRecord.findUnique({
      where: { userId_key: { userId: r.user.id, key } },
    });
    if (old) {
      assert(old.digest === digest, '幂等键已被其他请求使用', 409);
      return old.result;
    }
    const fresh = await tx.task.findUnique({ where: { id: t.id } });
    assert(
      fresh && fresh.version === input.expectedVersion,
      '版本冲突，请刷新后重试，保留当前输入',
      409,
    );
    const users = await tx.user.findMany({
      where: { id: { in: ms.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const people = users.map((u) => ({
      ...u,
      roles: ms.find((m) => m.userId === u.id)!.roles as any,
    }));
    const me = people.find((m) => m.id === r.user.id)!;
    if (input.action === 'FAIL_TEST') {
      const ids = z
        .array(z.string())
        .min(1)
        .max(100)
        .parse(input.payload.defectIds);
      const bugs = await tx.task.findMany({
        where: { id: { in: ids }, projectId: t.projectId },
      });
      assert(
        bugs.length === new Set(ids).size &&
          bugs.every(
            (b) =>
              (b.data as any).type === 'BUG' &&
              (b.data as any).parentId === t.id &&
              (b.data as any).parentRound === (fresh.data as any).tests.length,
          ),
        '缺陷必须属于本任务当前测试轮次',
      );
    }
    if (input.action === 'PASS_TEST') {
      const related = await tx.task.findMany({
        where: { projectId: t.projectId },
      });
      assert(
        !related.some(
          (b) =>
            (b.data as any).parentId === t.id &&
            (b.data as any).severity === 'BLOCKER' &&
            b.status !== 'CLOSED',
        ),
        '阻断缺陷尚未关闭',
      );
    }
    const next = execute(
      asTask(fresh),
      input.action,
      input.payload,
      me,
      people,
      undefined,
      (
        await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: t.workspaceId,
              userId: r.user.id,
            },
          },
        })
      )?.role === 'ADMIN',
    );
    const update = await tx.task.updateMany({
      where: { id: t.id, version: input.expectedVersion },
      data: {
        status: next.status,
        version: next.version,
        data: next.data as any,
      },
    });
    assert(update.count, '版本冲突', 409);
    await record(tx, r, t.workspaceId, t.id, input.action);
    for (const uid of new Set([
      ...handlers(next),
      next.data.productId,
      next.data.engineerId,
      next.data.testerId,
    ]))
      if (uid && uid !== r.user.id)
        await tx.notification.create({
          data: {
            recipientId: uid,
            workspaceId: t.workspaceId,
            projectId: t.projectId,
            taskId: t.id,
            message: `${next.data.title}：${input.action}`,
            dedupe: `${t.id}:${next.version}:${uid}`,
          },
        });
    await tx.idempotencyRecord.create({
      data: {
        userId: r.user.id,
        key,
        digest,
        result: next as any,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return next;
  });
  s.json(result);
});
router.post('/tasks/:id/actions', actionHandler);
// Convenience endpoints dispatch through the exact same action/transaction handler.
router.post('/tasks/:id/blocks', (r, s, n) => {
  r.body = {
    action: 'BLOCK',
    expectedVersion: r.body.expectedVersion,
    payload: { reason: r.body.reason },
  };
  actionHandler(r, s, n);
});
router.post(
  '/tasks/:id/blocks/:blockId/resolve',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id), true);
    assert(
      (t.data as any).blocks.some(
        (b: any) => b.id === r.params.blockId && !b.end,
      ),
      '当前阻塞不存在',
      404,
    );
    r.body = {
      action: 'UNBLOCK',
      expectedVersion: r.body.expectedVersion,
      payload: { reason: r.body.reason },
    };
    await new Promise<void>((resolve, reject) => {
      s.once('finish', resolve);
      actionHandler(r, s, reject);
    });
  }),
);
router.post('/tasks/:id/solutions', (r, s, n) => {
  if (r.body.submit === true) {
    r.body = {
      action: 'SUBMIT_SOLUTION',
      expectedVersion: r.body.expectedVersion,
      payload: r.body.payload,
    };
    actionHandler(r, s, n);
    return;
  }
  wrap(async (req, res) => {
    const t = await task(req, String(req.params.id), true),
      d = t.data as any;
    assert(t.status === 'SOLUTION_PENDING', '当前阶段不能编辑方案草稿', 409);
    const p = await project(req, t.projectId, true);
    assert(d.engineerId === req.user.id, '只有指定研发可保存方案草稿', 403);
    const draft = z
      .object({
        body: z.string().max(100000).default(''),
        scope: z.string().max(10000).default(''),
        effort: z.number().nonnegative().default(0),
        risk: z.string().max(10000).default(''),
        start: z.string().max(50).default(''),
        end: z.string().max(50).default(''),
      })
      .parse(req.body.payload);
    d.solutionDraft = {
      ...draft,
      by: req.user.id,
      at: new Date().toISOString(),
      requirementVersion: d.requirementVersion,
    };
    res.json(await save(req, t, d));
  })(r, s, n);
});
router.post(
  '/tasks/:id/requirement-changes',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id), true);
    assert(
      !terminal(t.status as any) && t.status !== 'DRAFT',
      '当前阶段不能提出变更',
    );
    const p = await project(r, t.projectId, true);
    assert(
      p.member?.roles.some((role) =>
        ['PRODUCT', 'ENGINEER', 'QA'].includes(role),
      ),
      '当前角色不能提出需求变更',
      403,
    );
    required(r.body, ['description', 'reason', 'impact']);
    const d = t.data as any;
    d.changes.push({
      id: randomUUID(),
      description: r.body.description,
      reason: r.body.reason,
      impact: r.body.impact,
      by: r.user.id,
      at: new Date().toISOString(),
      decision: 'PROPOSED',
    });
    s.json(await save(r, t, d));
  }),
);
router.get(
  '/tasks/:id/timeline',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id));
    const d = t.data as any;
    const attachments = await db.attachment.findMany({
      where: { taskId: t.id, deletedAt: null },
      select: { id: true, name: true, userId: true, createdAt: true },
    });
    const audit = await db.auditEvent.findMany({
      where: { workspaceId: t.workspaceId, resourceId: t.id },
      orderBy: { createdAt: 'asc' },
    });
    const events = [
      ...d.history.map((h: any) => ({ ...h, type: 'TRANSITION' })),
      ...d.comments.map((c: any) => ({ ...c, type: 'COMMENT' })),
      ...d.changes
        .filter((c: any) => c.decision === 'PROPOSED')
        .map((c: any) => ({ ...c, type: 'CHANGE_PROPOSAL' })),
      ...attachments.map((a) => ({
        ...a,
        type: 'ATTACHMENT',
        at: a.createdAt,
      })),
      ...audit
        .filter(
          (a) =>
            !actions.includes(a.action as any) &&
            !['COMMENT', 'ATTACHMENT'].includes(a.action),
        )
        .map((a) => ({ ...a, type: 'AUDIT', at: a.createdAt })),
    ];
    s.json(
      events.sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at)),
    );
  }),
);
router.get(
  '/tasks/:id/comments',
  wrap(async (r, s) =>
    s.json(((await task(r, String(r.params.id))).data as any).comments),
  ),
);
router.post(
  '/tasks/:id/comments',
  wrap(async (r, s) => {
    const t = await task(r, String(r.params.id), true);
    const body = z.string().min(1).max(20000).parse(r.body.body),
      mentions = z
        .array(z.string())
        .max(50)
        .parse(r.body.mentions || []);
    const people = await members(t.projectId);
    assert(
      mentions.every((id) => people.some((m) => m.id === id)),
      '只能提及项目成员',
    );
    assert(
      z.number().int().positive().parse(r.body.expectedVersion) === t.version,
      '版本冲突，请保留输入并刷新',
      409,
    );
    const d = t.data as any,
      comment = {
        id: randomUUID(),
        body,
        mentions,
        by: r.user.id,
        name: r.user.name,
        at: new Date().toISOString(),
      };
    d.comments.push(comment);
    await db.$transaction(async (tx) => {
      await projectWrite(tx, r, t.projectId);
      const current = await tx.projectMember.findMany({
        where: { projectId: t.projectId },
      });
      assert(
        mentions.every((id) => current.some((m) => m.userId === id)),
        '提及成员已移出项目',
        409,
      );
      const u = await tx.task.updateMany({
        where: { id: t.id, version: r.body.expectedVersion, deletedAt: null },
        data: { data: d, version: { increment: 1 } },
      });
      assert(u.count, '版本冲突，请刷新', 409);
      await record(tx, r, t.workspaceId, t.id, 'COMMENT');
      for (const uid of new Set(mentions))
        await tx.notification.create({
          data: {
            recipientId: uid,
            workspaceId: t.workspaceId,
            projectId: t.projectId,
            taskId: t.id,
            message: `${r.user.name} 在评论中提及你`,
            dedupe: `comment:${comment.id}:${uid}`,
          },
        });
    });
    s.json(comment);
  }),
);
router.get(
  '/me/todos',
  wrap(async (r, s) => {
    const ps = await db.projectMember.findMany({
        where: { userId: r.user.id },
      }),
      activeProjects = await db.project.findMany({
        where: { id: { in: ps.map((p) => p.projectId) }, archivedAt: null },
        select: { id: true },
      }),
      ts = await db.task.findMany({
        where: {
          projectId: { in: activeProjects.map((p) => p.id) },
          status: { notIn: ['CLOSED', 'CANCELLED'] },
          deletedAt: null,
        },
      });
    s.json(ts.map(asTask).filter((t) => handlers(t).includes(r.user.id)));
  }),
);
router.get(
  '/notifications',
  wrap(async (r, s) => {
    const ps = await db.projectMember.findMany({
      where: { userId: r.user.id },
    });
    const workspaceId = r.query.workspace ? String(r.query.workspace) : '';
    if (workspaceId) await workspace(r, workspaceId);
    const where = {
      ...(workspaceId ? { workspaceId } : {}),
      recipientId: r.user.id,
      projectId: { in: ps.map((p) => p.projectId) },
    };
    const p = page(r);
    s.json({
      ...p,
      total: await db.notification.count({ where }),
      unreadCount: await db.notification.count({
        where: { ...where, readAt: null },
      }),
      items: await db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
      }),
    });
  }),
);
router.post(
  '/notifications/:id/read',
  wrap(async (r, s) => {
    const notification = await db.notification.findFirst({
      where: { id: String(r.params.id), recipientId: r.user.id },
    });
    assert(notification, '资源不存在', 404);
    await project(r, notification.projectId);
    await db.notification.updateMany({
      where: { id: String(r.params.id), recipientId: r.user.id },
      data: { readAt: new Date() },
    });
    s.json({ ok: true });
  }),
);
router.get(
  '/projects/:id/metrics',
  wrap(async (r, s) => {
    await project(r, String(r.params.id));
    s.json(
      metrics(
        (
          await db.task.findMany({
            where: { projectId: String(r.params.id), deletedAt: null },
          })
        ).map(asTask),
      ),
    );
  }),
);
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
router.get(
  '/projects/:id/documents',
  wrap(async (r, s) => {
    await project(r, String(r.params.id));
    s.json(
      await db.document.findMany({ where: { projectId: String(r.params.id) } }),
    );
  }),
);
async function documentInput(r: AuthRequest, projectId: string) {
  const input = z
    .object({
      title: z.string().min(1).max(200),
      content: z.string().max(200000),
      taskIds: z.array(z.string()).max(100).default([]),
    })
    .parse(r.body);
  assert(
    (await db.task.count({
      where: { projectId, id: { in: input.taskIds } },
    })) === new Set(input.taskIds).size,
    '关联任务不属于本项目',
  );
  return input;
}
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
      where: { projectId: document.projectId, id: { in: document.taskIds } },
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
installAttachmentRoutes(router, {
  db,
  wrap,
  task,
  project,
  projectWrite,
  record,
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
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
@Module({})
class AppModule {}
export async function start() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use((r: AuthRequest, s: Response, n: NextFunction) => {
    r.requestId = randomUUID();
    s.setHeader('X-Request-ID', r.requestId);
    s.setHeader('X-Content-Type-Options', 'nosniff');
    n();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1', router);
  if (process.env.SERVE_WEB === 'true') {
    const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    app.use(express.static(webRoot));
    app.use((r: AuthRequest, s: Response, next: NextFunction) => {
      if (
        r.method === 'GET' &&
        !r.path.startsWith('/api/') &&
        !path.extname(r.path)
      )
        return s.sendFile(path.join(webRoot, 'index.html'));
      next();
    });
  }
  app.use((r: AuthRequest, s: Response) =>
    s.status(404).json({
      code: 'NOT_FOUND',
      message: '接口不存在',
      requestId: r.requestId,
    }),
  );
  app.use((e: any, r: AuthRequest, s: Response, _n: NextFunction) => {
    const status =
      e instanceof BusinessError
        ? e.status
        : e instanceof z.ZodError
          ? 422
          : e.code === 'LIMIT_FILE_SIZE'
            ? 413
            : e.type === 'entity.too.large'
              ? 413
              : e.type === 'entity.parse.failed'
                ? 400
                : ['P2002', 'P2034'].includes(e.code)
                  ? 409
                  : e.code === 'P2025'
                    ? 404
                    : ['P2003', 'P2004'].includes(e.code)
                      ? 422
                      : 500;
    console.error(
      JSON.stringify({
        requestId: r.requestId,
        code: e.code || 'ERROR',
        status,
      }),
    );
    s.status(status).json({
      code: status === 409 ? 'CONFLICT' : e.code || 'ERROR',
      message:
        status === 500
          ? '服务暂时不可用'
          : e instanceof BusinessError || e instanceof z.ZodError
            ? e.message
            : status === 409
              ? '数据冲突，请刷新后重试'
              : status === 413
                ? '请求内容超过大小限制'
                : status === 404
                  ? '资源不存在'
                  : status === 400
                    ? '请求 JSON 格式错误'
                    : '数据校验失败',
      fieldErrors: e instanceof z.ZodError ? e.flatten() : undefined,
      requestId: r.requestId,
    });
  });
  await app.listen(
    Number(process.env.PORT || 3001),
    process.env.HOST || '127.0.0.1',
  );
}
if (!process.env.COFLOW_IMPORT_ONLY) start();
