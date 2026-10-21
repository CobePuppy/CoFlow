import 'dotenv/config';
import 'reflect-metadata';
import { templateInputSchema } from '../requirements/templates.js';

import express from 'express';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import {
  db,
  record,
  templateAccess,
  templateWrite,
  wrap,
} from '../../shared/context.js';
export function installTemplatesRoutes(router: express.Router) {
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
}
