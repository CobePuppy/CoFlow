import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { assert } from '../requirements/domain.js';

import { db, project, wrap } from '../../shared/context.js';
export function installNotificationReadRoutes(router: express.Router) {
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
}
