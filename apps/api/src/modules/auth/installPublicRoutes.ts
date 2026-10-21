import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import {
  attempts,
  db,
  hash,
  origin,
  registrationAttempts,
  wrap,
} from '../../shared/context.js';
export function installPublicRoutes(router: express.Router) {
  router.get(
    '/health',
    wrap(async (_r, s) => {
      await db.$queryRaw`SELECT 1`;
      s.json({ ok: true });
    }),
  );

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
      const i = await db.invitation.findUnique({
        where: { hash: hash(token) },
      });
      assert(
        i && !i.acceptedAt && i.expiresAt.getTime() > Date.now(),
        '邀请无效或已过期',
        404,
      );
      const w = await db.workspace.findUnique({ where: { id: i.workspaceId } });
      s.json({
        email: i.email,
        workspaceName: w?.name,
        expiresAt: i.expiresAt,
      });
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
      for (const [k, v] of attempts)
        if (v.until < Date.now()) attempts.delete(k);
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
}
