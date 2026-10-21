import { isOverdue } from '@coflow/contracts/deadline.js';
import { labels, terminal, type Task } from '@coflow/contracts/index.js';
import express, { type RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assert, handlers } from '../requirements/domain.js';
import { qqSettingsSchema, qqTaskUrl } from './settings.js';
const context = new AsyncLocalStorage<{ workspaceId: string; config?: any }>();

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const qqSchema = z.string().regex(/^[1-9][0-9]{4,14}$/);
const asyncRoute =
  (fn: (r: any, s: any) => Promise<any>): RequestHandler =>
  (r, s, next) => {
    context.run(
      {
        ...context.getStore(),
        workspaceId:
          String(r.params.id || '').trim() ||
          context.getStore()?.workspaceId ||
          process.env.QQ_BOT_WORKSPACE_ID ||
          '',
      },
      () => Promise.resolve(fn(r, s)).catch(next),
    );
  };

export function selectQQTasks(
  tasks: Task[],
  userId: string,
  mode: string,
  now = Date.now(),
) {
  return tasks
    .filter((t) => {
      if (terminal(t.status) || t.deletedAt) return false;
      const d = t.data;
      const mine =
        mode === 'all'
          ? [
              d.productId,
              d.engineerId,
              d.testerId,
              d.productReviewerId,
              d.qaReviewerId,
            ].includes(userId)
          : handlers(t).includes(userId);
      return mine && (mode !== 'overdue' || isOverdue(d.dueAt, now));
    })
    .sort((a, b) => {
      const overdue = (t: Task) => isOverdue(t.data.dueAt, now);
      return (
        Number(overdue(b)) - Number(overdue(a)) ||
        a.data.priority.localeCompare(b.data.priority) ||
        (Date.parse(a.data.dueAt || '') || Infinity) -
          (Date.parse(b.data.dueAt || '') || Infinity) ||
        a.id.localeCompare(b.id)
      );
    });
}

export function createQQRoutes(db: any) {
  const bot = express.Router(),
    account = express.Router();
  const scope = () =>
    context.getStore()?.workspaceId || process.env.QQ_BOT_WORKSPACE_ID || '';
  async function config(workspaceId: string, tx = db) {
    const row = await tx.qQIntegration?.findUnique({ where: { workspaceId } });
    if (row) return { ...row, configured: !!row.tokenHash, source: 'DATABASE' };
    const legacy =
      workspaceId === process.env.QQ_BOT_WORKSPACE_ID &&
      (process.env.QQ_BOT_TOKEN || '').length >= 32;
    return {
      configured: legacy,
      enabled: legacy,
      tokenHash: legacy ? hash(process.env.QQ_BOT_TOKEN!) : null,
      tokenHint: legacy ? '环境变量配置' : '',
      pushEnabled: true,
      pushTimes: '09:00,18:00',
      webUrl:
        process.env.QQ_BOT_WEB_URL ||
        process.env.APP_ORIGIN ||
        'http://localhost:5173',
      version: 0,
      source: 'ENVIRONMENT',
    };
  }
  // Installed before browser session middleware; this router has its own authentication.
  bot.use((r, s, next) => {
    const workspaceId = String(
      r.headers['x-coflow-workspace'] || process.env.QQ_BOT_WORKSPACE_ID || '',
    );
    Promise.resolve()
      .then(async () => {
        assert(workspaceId, 'QQ集成未指定团队', 503);
        const c = await config(workspaceId);
        assert(c.enabled && c.configured, 'QQ集成尚未启用或配置', 503);
        const incoming = String(r.headers.authorization || '').replace(
          /^Bearer /,
          '',
        );
        assert(
          timingSafeEqual(
            Buffer.from(hash(incoming)),
            Buffer.from(c.tokenHash),
          ),
          '机器人凭据无效',
          401,
        );
        assert(!r.headers.origin, '机器人接口不接受浏览器请求', 403);
        s.setHeader('Cache-Control', 'no-store');
        context.run({ workspaceId, config: c }, () => next());
      })
      .catch(next);
  });
  const limits = new Map<string, { count: number; expires: number }>();
  bot.use((r, _s, next) => {
    const key = scope() + ':' + (r.path === '/bind' ? 'bind' : 'read');
    const old = limits.get(key);
    const current =
      old && old.expires > Date.now()
        ? old
        : { count: 0, expires: Date.now() + 60000 };
    limits.set(key, current);
    try {
      assert(
        ++current.count <= (r.path === '/bind' ? 30 : 600),
        '请求过于频繁，请稍后重试',
        429,
      );
      next();
    } catch (e) {
      next(e);
    }
  });
  async function member(userId: string, tx = db) {
    assert(
      await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: scope(), userId } },
      }),
      '当前账号已不属于该团队',
      403,
    );
  }
  async function binding(qq: string) {
    const b = await db.qQBinding.findUnique({
      where: { workspaceId_qq: { workspaceId: scope(), qq } },
    });
    assert(b, '尚未绑定，请在汇流个人设置中生成绑定码', 404);
    await member(b.userId);
    return b;
  }
  async function locked(tx: any) {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${scope()} FOR UPDATE`;
  }
  bot.post(
    '/bind',
    asyncRoute(async (r, s) => {
      const { qq, code } = z
        .object({ qq: qqSchema, code: z.string().regex(/^[a-f0-9]{32}$/) })
        .parse(r.body);
      await db.$transaction(async (tx: any) => {
        await locked(tx);
        const pending = await tx.qQBindingCode.findUnique({
          where: { hash: hash(code) },
        });
        assert(
          pending &&
            pending.workspaceId === scope() &&
            pending.expiresAt.getTime() > Date.now(),
          '绑定码无效或已过期',
          422,
        );
        await member(pending.userId, tx);
        assert(
          !(await tx.qQBinding.findFirst({
            where: {
              workspaceId: scope(),
              OR: [{ userId: pending.userId }, { qq }],
            },
          })),
          '账号已绑定，请先在平台解绑',
          409,
        );
        await tx.qQBinding.create({
          data: { workspaceId: scope(), userId: pending.userId, qq },
        });
        await tx.qQBindingCode.delete({ where: { hash: pending.hash } });
      });
      s.json({ ok: true });
    }),
  );
  bot.get(
    '/policy',
    asyncRoute(async (_r, s) => {
      const c = await config(scope());
      s.json({
        pushEnabled: c.pushEnabled,
        pushTimes: c.pushTimes,
        timezone: 'Asia/Shanghai',
      });
    }),
  );
  bot.get(
    '/recipients',
    asyncRoute(async (r, s) => {
      const policy = await config(scope());
      if (!policy.pushEnabled) {
        s.json({ items: [], nextCursor: null });
        return;
      }
      const cursor = z.string().max(100).default('').parse(r.query.cursor);
      const rows = await db.qQBinding.findMany({
        where: {
          workspaceId: scope(),
          ...(cursor ? { userId: { gt: cursor } } : {}),
        },
        orderBy: { userId: 'asc' },
        take: 100,
      });
      const members = await db.workspaceMember.findMany({
        where: {
          workspaceId: scope(),
          userId: { in: rows.map((b: any) => b.userId) },
        },
      });
      s.json({
        items: rows
          .filter((b: any) => members.some((m: any) => m.userId === b.userId))
          .map((b: any) => ({ qq: b.qq })),
        nextCursor: rows.length === 100 ? rows.at(-1).userId : null,
      });
    }),
  );
  bot.get(
    '/work',
    asyncRoute(async (r, s) => {
      const { qq, mode, page } = z
        .object({
          qq: qqSchema,
          mode: z.enum(['current', 'all', 'overdue']).default('current'),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .parse(r.query);
      const b = await binding(qq);
      const memberships = await db.projectMember.findMany({
        where: { userId: b.userId },
      });
      const projects = await db.project.findMany({
        where: {
          workspaceId: scope(),
          archivedAt: null,
          id: { in: memberships.map((m: any) => m.projectId) },
        },
      });
      const rows = await db.task.findMany({
        where: {
          workspaceId: scope(),
          projectId: { in: projects.map((p: any) => p.id) },
          status: { notIn: ['CLOSED', 'CANCELLED'] },
          deletedAt: null,
        },
      });
      const now = Date.now();
      const items = selectQQTasks(rows as Task[], b.userId, mode, now);
      const base = (await config(scope())).webUrl;
      const preference = await db.userSettings?.findUnique({
        where: { userId: b.userId },
      });
      const url = new URL(base);
      assert(
        ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password,
        '平台链接配置错误',
        503,
      );
      s.json({
        total: items.length,
        page,
        pageSize: 8,
        items: items.slice((page - 1) * 8, page * 8).map((t) => {
          const link = new URL(base);
          link.search = '';
          link.searchParams.set('task', t.id);
          link.searchParams.set('workspace', scope());
          link.searchParams.set('project', t.projectId);
          return {
            id: t.id,
            number: t.number,
            title: t.data.title,
            project: projects.find((p: any) => p.id === t.projectId)?.name,
            status: labels[t.status],
            priority: t.data.priority,
            dueAt: t.data.dueAt || null,
            overdue: isOverdue(t.data.dueAt, now),
            blocked: t.data.blocks.some((b) => !b.end),
            url: qqTaskUrl(
              base,
              t.id,
              scope(),
              t.projectId,
              preference?.preferredEdition,
            ),
          };
        }),
      });
    }),
  );
  // Browser endpoints are mounted after the existing session + CSRF checks.
  const checkAccount = async (r: any) => {
    assert(
      await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: scope(), userId: r.user.id },
        },
      }),
      '资源不存在',
      404,
    );
    return config(scope());
  };
  account.get(
    '/workspaces/:id/qq-integration',
    asyncRoute(async (r, s) => {
      await member(r.user.id);
      const m = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: scope(), userId: r.user.id },
        },
      });
      const c = await config(scope());
      s.setHeader('Cache-Control', 'no-store');
      s.json({
        canManage: m.role === 'ADMIN',
        configured: c.configured,
        enabled: c.enabled,
        pushEnabled: c.pushEnabled,
        pushTimes: c.pushTimes,
        webUrl: c.webUrl,
        version: c.version,
        tokenHint: c.tokenHint || '',
        source: c.source,
      });
    }),
  );
  account.patch(
    '/workspaces/:id/qq-integration',
    asyncRoute(async (r, s) => {
      await member(r.user.id);
      const input = qqSettingsSchema.parse(r.body);
      await db.$transaction(async (tx: any) => {
        await locked(tx);
        const m = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: scope(), userId: r.user.id },
          },
        });
        assert(m?.role === 'ADMIN', '需要团队管理员权限', 403);
        const previous = await config(scope(), tx);
        assert(
          previous.version === input.expectedVersion,
          '团队集成设置已变化，请刷新后重试',
          409,
        );
        assert(
          !input.enabled || input.accessToken || previous.tokenHash,
          '请先设置机器人专用令牌',
        );
        const data = {
          enabled: input.enabled,
          pushEnabled: input.pushEnabled,
          pushTimes: input.pushTimes,
          webUrl: input.webUrl,
          tokenHash: input.accessToken
            ? hash(input.accessToken)
            : previous.tokenHash,
          tokenHint: input.accessToken
            ? '••••' + input.accessToken.slice(-4)
            : previous.tokenHint || null,
          version: previous.version + 1,
        };
        await tx.qQIntegration.upsert({
          where: { workspaceId: scope() },
          create: { workspaceId: scope(), ...data },
          update: data,
        });
        await tx.auditEvent.create({
          data: {
            workspaceId: scope(),
            resourceId: scope(),
            actorId: r.user.id,
            action: 'QQ_SETTINGS_UPDATE',
          },
        });
      });
      s.setHeader('Cache-Control', 'no-store');
      s.json({ ok: true });
    }),
  );
  account.get(
    '/workspaces/:id/qq-binding',
    asyncRoute(async (r, s) => {
      const c = await checkAccount(r);
      s.setHeader('Cache-Control', 'no-store');
      const b = await db.qQBinding.findUnique({
        where: {
          workspaceId_userId: { workspaceId: scope(), userId: r.user.id },
        },
      });
      s.json({
        qq: b?.qq || null,
        configured: c.configured,
        enabled: c.enabled,
      });
    }),
  );
  account.post(
    '/workspaces/:id/qq-binding/code',
    asyncRoute(async (r, s) => {
      await checkAccount(r);
      const policy = await config(scope());
      assert(
        policy.enabled && policy.configured,
        '请联系团队管理员启用QQ集成',
        422,
      );
      const code = randomBytes(16).toString('hex'),
        expiresAt = new Date(Date.now() + 10 * 60000);
      await db.$transaction(async (tx: any) => {
        await locked(tx);
        await member(r.user.id, tx);
        assert(
          !(await tx.qQBinding.findUnique({
            where: {
              workspaceId_userId: { workspaceId: scope(), userId: r.user.id },
            },
          })),
          '请先解除现有绑定',
          409,
        );
        await tx.qQBindingCode.upsert({
          where: {
            workspaceId_userId: { workspaceId: scope(), userId: r.user.id },
          },
          create: {
            workspaceId: scope(),
            userId: r.user.id,
            hash: hash(code),
            expiresAt,
          },
          update: { hash: hash(code), expiresAt },
        });
      });
      s.setHeader('Cache-Control', 'no-store');
      s.json({ code, expiresAt });
    }),
  );
  account.delete(
    '/workspaces/:id/qq-binding',
    asyncRoute(async (r, s) => {
      await checkAccount(r);
      await db.$transaction(async (tx: any) => {
        await locked(tx);
        await tx.qQBinding.deleteMany({
          where: { workspaceId: scope(), userId: r.user.id },
        });
        await tx.qQBindingCode.deleteMany({
          where: { workspaceId: scope(), userId: r.user.id },
        });
      });
      s.json({ ok: true });
    }),
  );
  return { bot, account };
}
