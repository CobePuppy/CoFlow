import { encryptKey } from '../../infrastructure/security/encryption.js';
import {
  firstStepCredentials,
  verifyFirstStepKey,
  withFirstStepLimit,
} from '../ai/firststep.js';

import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import argon2 from 'argon2';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import {
  db,
  savedCredentials,
  settingsView,
  wrap,
} from '../../shared/context.js';
export function installSettingsRoutes(router: express.Router) {
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
}
