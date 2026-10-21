import { Prisma } from '@prisma/client';
import { handling } from '../requirements/query-sql.js';
import 'dotenv/config';
import 'reflect-metadata';

import express from 'express';

import { handlers } from '../requirements/domain.js';

import { asTask, db, workspace, wrap } from '../../shared/context.js';
export function installOverviewRoutes(router: express.Router) {
  router.get(
    '/workspaces/:id/overview-summary',
    wrap(async (r, s) => {
      const wid = String(r.params.id);
      await workspace(r, wid);
      const result = await db.$transaction(
        async (tx) => {
          const memberships = await tx.projectMember.findMany({
            where: { userId: r.user.id },
            select: { projectId: true },
          });
          const projects = await tx.project.findMany({
            where: {
              workspaceId: wid,
              id: { in: memberships.map((m) => m.projectId) },
            },
          });
          const ids = projects.filter((p) => !p.archivedAt).map((p) => p.id);
          const condition = Prisma.sql`"workspaceId"=${wid} AND "projectId" IN (${ids.length ? Prisma.join(ids) : Prisma.sql`NULL`}) AND "deletedAt" IS NULL AND status NOT IN ('CLOSED','CANCELLED')`;
          const counts = await tx.$queryRaw<
            { projectId: string; total: number }[]
          >(
            Prisma.sql`SELECT "projectId",count(*)::int AS total FROM "Task" WHERE ${condition} GROUP BY "projectId"`,
          );
          const todos = await tx.$queryRaw<
            any[]
          >(Prisma.sql`SELECT id,"projectId",status,
          jsonb_build_object('title',data->'title','priority',data->'priority','dueAt',data->'dueAt','workflow',data->'workflow',
          'blocks',COALESCE((SELECT jsonb_agg(jsonb_build_object('reason',b->>'reason')) FROM jsonb_array_elements(COALESCE(data->'blocks','[]'::jsonb)) b WHERE COALESCE(b->>'end','')=''),'[]'::jsonb)) AS data
          FROM "Task" WHERE ${condition} AND ${handling(r.user.id)} ORDER BY "createdAt",id`);
          const competitions = await tx.competition.findMany({
            where: { workspaceId: wid, stage: { notIn: ['FINISHED'] } },
            select: { id: true, name: true, deadline: true },
            orderBy: { updatedAt: 'desc' },
          });
          const documents = await tx.document.findMany({
            where: { projectId: { in: ids } },
            select: { id: true, title: true, projectId: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 6,
          });
          const byProject = new Map(counts.map((c) => [c.projectId, c.total]));
          return {
            projects: projects.map((p) => ({
              ...p,
              openTasks: byProject.get(p.id) || 0,
            })),
            todos,
            competitions,
            documents,
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
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
      const [tasks, competitions, documents] = await Promise.all([
        db.task.findMany({
          where: {
            projectId: { in: ids },
            status: { notIn: ['CLOSED', 'CANCELLED'] },
            deletedAt: null,
          },
        }),
        db.competition.findMany({
          where: { workspaceId: wid, stage: { notIn: ['FINISHED'] } },
          orderBy: { updatedAt: 'desc' },
        }),
        db.document.findMany({
          where: { projectId: { in: ids } },
          select: { id: true, title: true, projectId: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 6,
        }),
      ]);
      const todos = tasks
        .map(asTask)
        .filter((t) => handlers(t).includes(r.user.id));
      const openCounts = new Map<string, number>();
      for (const t of tasks)
        openCounts.set(t.projectId, (openCounts.get(t.projectId) || 0) + 1);
      s.json({
        projects: projects.map((p) => ({
          ...p,
          openTasks: openCounts.get(p.id) || 0,
        })),
        todos,
        competitions,
        documents,
      });
    }),
  );
}
