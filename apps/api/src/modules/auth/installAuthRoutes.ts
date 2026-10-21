import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { db, wrap } from '../../shared/context.js';
export function installAuthRoutes(router: express.Router) {
  router.get(
    '/auth/me',
    wrap(async (r, s) =>
      s.json({
        user: { id: r.user.id, name: r.user.name, email: r.user.email },
        csrf: r.session.csrf,
      }),
    ),
  );

  router.post(
    '/auth/logout',
    wrap(async (r, s) => {
      await db.session.delete({ where: { hash: r.session.hash } });
      s.clearCookie('coflow', { path: '/' }).json({ ok: true });
    }),
  );
}
