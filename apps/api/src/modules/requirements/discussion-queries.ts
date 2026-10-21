import { questionEvents } from './discussion-sql.js';
import { assert } from './domain.js';
import type { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, page, project, workspace, wrap } from '../../shared/access.js';
export function installDiscussionQueries(router: Router) {
  router.get(
    '/tasks/:id/discussion-updates',
    wrap(async (r, s) => {
      const id = String(r.params.id);
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .max(10000000)
        .default(0)
        .parse(r.query.after);
      const identity = await db.task.findUnique({
        where: { id },
        select: { id: true, projectId: true },
      });
      assert(identity, '资源不存在', 404);
      await project(r, identity.projectId);
      const rows = await db.$queryRaw<
        any[]
      >(Prisma.sql`SELECT version AS "taskVersion", (data->>'requirementVersion')::int AS "requirementVersion",
      jsonb_array_length(COALESCE(data->'comments','[]'::jsonb)) AS total,
      (${after}=0 OR ${after}>jsonb_array_length(COALESCE(data->'comments','[]'::jsonb))) AS reset,
      CASE WHEN ${after}>jsonb_array_length(COALESCE(data->'comments','[]'::jsonb)) THEN 0 ELSE ${after} END::int AS "from",
      CASE WHEN ${after}=jsonb_array_length(COALESCE(data->'comments','[]'::jsonb)) THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(e.value ORDER BY e.n) FROM jsonb_array_elements(COALESCE(data->'comments','[]'::jsonb)) WITH ORDINALITY e(value,n)
        WHERE e.n>CASE WHEN ${after}>jsonb_array_length(COALESCE(data->'comments','[]'::jsonb)) THEN 0 ELSE ${after} END),'[]'::jsonb) END AS comments
      FROM "Task" WHERE id=${id}`);
      assert(rows[0], '资源不存在', 404);
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(rows[0]);
    }),
  );
  router.get(
    '/workspaces/:id/discussions',
    wrap(async (r, s) => {
      const wid = String(r.params.id);
      await workspace(r, wid);
      const pagination = page(r);
      const input = z
        .object({
          scope: z.enum(['mine', 'all', 'created']).default('mine'),
          state: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN'),
          overdue: z.enum(['true', 'false']).default('false'),
          q: z.string().trim().max(200).default(''),
          project: z.string().uuid().optional(),
        })
        .parse(r.query);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const number = input.q.match(/^(?:CF-)?0*(\d+)$/i)?.[1] || '';
      const base = Prisma.sql`${questionEvents(r.user.id, wid, input.project)}, filtered AS (SELECT * FROM questions WHERE true
      ${input.scope === 'mine' ? Prisma.sql`AND "assigneeId"=${r.user.id}` : input.scope === 'created' ? Prisma.sql`AND "createdBy"=${r.user.id}` : Prisma.empty}
      ${input.state === 'OPEN' ? Prisma.sql`AND NOT resolved` : input.state === 'RESOLVED' ? Prisma.sql`AND resolved` : Prisma.empty}
      ${input.overdue === 'true' ? Prisma.sql`AND NOT resolved AND "dueAt" < ${today}` : Prisma.empty}
      ${input.q ? Prisma.sql`AND (strpos(lower(body || ' ' || "taskTitle"), lower(${input.q}))>0 OR number::text=${number})` : Prisma.empty}
    )`;
      const result = await db.$transaction(
        async (tx) => {
          const count = await tx.$queryRaw<{ total: number }[]>(
            Prisma.sql`${base} SELECT count(*)::int AS total FROM filtered`,
          );
          const items = await tx.$queryRaw<any[]>(
            Prisma.sql`${base} SELECT f."taskId",f."projectId",f.number,f."taskVersion",f."projectName",f."taskTitle",f."currentRequirementVersion",f.id,left(f.body,400) AS body,f."createdBy",f."createdByName",f."createdAt",f."assigneeId",f."dueAt",f.resolved,f."checkedVersion", u.name AS "assigneeName", EXISTS(SELECT 1 FROM "ProjectMember" m JOIN "WorkspaceMember" w ON w."userId"=m."userId" AND w."workspaceId"=${wid} WHERE m."projectId"=f."projectId" AND m."userId"=f."assigneeId") AS "assigneeActive", (NOT f.resolved AND f."dueAt" < ${today}) IS TRUE AS overdue, (f."checkedVersion" IS DISTINCT FROM f."currentRequirementVersion") AS "needsReview" FROM filtered f LEFT JOIN "User" u ON u.id=f."assigneeId" ORDER BY (NOT f.resolved AND f."dueAt" < ${today}) DESC NULLS LAST, f."dueAt" ASC NULLS LAST, f."createdAt" DESC, f.id ASC LIMIT ${pagination.pageSize} OFFSET ${(pagination.page - 1) * pagination.pageSize}`,
          );
          return { ...pagination, total: count[0].total, items };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      s.setHeader('Cache-Control', 'private, no-store');
      s.json(result);
    }),
  );
}
