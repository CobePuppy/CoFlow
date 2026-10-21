import { competitionInput } from './schema.js';

import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { z } from 'zod';
import { assert } from '../requirements/domain.js';

import {
  db,
  project,
  projectWrite,
  record,
  workspace,
  wrap,
} from '../../shared/context.js';
export function installCompetitionsRoutes(router: express.Router) {
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
}
