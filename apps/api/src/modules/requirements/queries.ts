import { handling } from './query-sql.js';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { db, page, project, workspace, wrap } from '../../shared/access.js';
import { assert } from './domain.js';
import {
  requirementNumber,
  requirementSorts,
} from '@coflow/contracts/requirement-list.js';
const terminal = Prisma.sql`status IN ('CLOSED','CANCELLED')`;
const blocked = Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'blocks','[]'::jsonb)) b WHERE COALESCE(b->>'end','') = '')`;
const owners = Prisma.sql`ARRAY[data->>'productId',data->>'engineerId',data->>'testerId',data->>'productReviewerId',data->>'qaReviewerId']`;
export async function requirementSummaries(r: any) {
  const p = await project(r, String(r.params.id));
  const member = await workspace(r, p.workspaceId);
  const pagination = page(r as Request);
  const sort = String(r.query.sort || 'updated');
  assert(requirementSorts.includes(sort as any), '排序方式无效');
  const order =
    sort === 'due'
      ? Prisma.sql`NULLIF(LEFT(data->>'dueAt',10),'') ASC NULLS LAST, "updatedAt" DESC,id ASC`
      : sort === 'priority'
        ? Prisma.sql`CASE data->>'priority' WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END ASC, "updatedAt" DESC,id ASC`
        : Prisma.sql`"updatedAt" DESC,id ASC`;
  const scope = String(r.query.scope || (r.query.status ? 'all' : 'active'));
  assert(
    ['all', 'active', 'ended', 'handling', 'mine', 'overdue', 'trash'].includes(
      scope,
    ),
    '需求范围无效',
  );
  const where = [
    Prisma.sql`"projectId" = ${p.id}`,
    scope === 'trash'
      ? Prisma.sql`"deletedAt" IS NOT NULL`
      : Prisma.sql`"deletedAt" IS NULL`,
  ];
  if (scope === 'active') where.push(Prisma.sql`NOT (${terminal})`);
  if (scope === 'ended') where.push(terminal);
  if (scope === 'handling')
    where.push(Prisma.sql`NOT (${terminal}) AND ${handling(r.user.id)}`);
  if (scope === 'mine') where.push(Prisma.sql`${r.user.id} = ANY(${owners})`);
  if (scope === 'overdue')
    where.push(
      Prisma.sql`NOT (${terminal}) AND LEFT(COALESCE(data->>'dueAt',''),10) <> '' AND LEFT(data->>'dueAt',10) < to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`,
    );
  for (const key of ['status', 'priority', 'owner', 'q', 'blocked']) {
    const value = typeof r.query[key] === 'string' ? r.query[key] : '';
    if (!value) continue;
    if (key === 'status') where.push(Prisma.sql`status = ${value}`);
    if (key === 'priority')
      where.push(Prisma.sql`data->>'priority' = ${value}`);
    if (key === 'owner') where.push(Prisma.sql`${value} = ANY(${owners})`);
    if (key === 'q') {
      const number = requirementNumber(value);
      where.push(
        number !== null
          ? Prisma.sql`number = ${number}`
          : Prisma.sql`strpos(lower(COALESCE(data->>'title','') || ' ' || COALESCE(data->>'description','')),lower(${value.trim()})) > 0`,
      );
    }
    if (key === 'blocked')
      where.push(value === 'true' ? blocked : Prisma.sql`NOT (${blocked})`);
  }
  const condition = Prisma.join(where, ' AND ');
  const result = await db.$transaction(
    async (tx) => {
      const counts = await tx.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT count(*)::int AS total FROM "Task" WHERE ${condition}`,
      );
      const items = await tx.$queryRaw<
        any[]
      >(Prisma.sql`SELECT id,"workspaceId","projectId",number,status,version,"deletedAt","deletedBy","createdAt","updatedAt",
      jsonb_build_object('title',data->'title','goal',data->'goal','description',left(COALESCE(data->>'description',''),160),'priority',data->'priority','dueAt',data->'dueAt','type',data->'type','workflow',data->'workflow','createdBy',data->'createdBy','productId',data->'productId','engineerId',data->'engineerId','testerId',data->'testerId','productReviewerId',data->'productReviewerId','qaReviewerId',data->'qaReviewerId','blocks',CASE WHEN ${blocked} THEN '[{}]'::jsonb ELSE '[]'::jsonb END) AS data,
      CASE WHEN "deletedAt" IS NOT NULL OR ${terminal} THEN '[]'::jsonb
      WHEN status IN ('DRAFT','ACCEPTANCE_PENDING') THEN jsonb_build_array(data->>'productId')
      WHEN status IN ('READY_FOR_TEST','TESTING') THEN jsonb_build_array(data->>'testerId')
      WHEN status = 'SOLUTION_REVIEW' THEN COALESCE((SELECT jsonb_agg(person) FROM unnest(ARRAY[data->>'productReviewerId',data->>'qaReviewerId']) person WHERE person <> '' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'reviews','[]'::jsonb)) r WHERE r->>'userId'=person AND (r->>'round')::int=jsonb_array_length(COALESCE(data->'solutions','[]'::jsonb)))),'[]'::jsonb)
      ELSE jsonb_build_array(data->>'engineerId') END AS "handlerIds"
      FROM "Task" WHERE ${condition} ORDER BY ${order} OFFSET ${(pagination.page - 1) * pagination.pageSize} LIMIT ${pagination.pageSize}`);
      return { total: counts[0].total, items };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return {
    ...pagination,
    ...result,
    canManage: member.role === 'ADMIN',
    readOnly: !!p.archivedAt,
  };
}
export function installRequirementQueries(router: any) {
  router.get(
    '/projects/:id/task-summaries',
    wrap(async (r, s) => s.json(await requirementSummaries(r))),
  );
}
