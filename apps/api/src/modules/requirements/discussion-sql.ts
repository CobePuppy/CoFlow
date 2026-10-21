import { Prisma } from '@prisma/client';
export function questionEvents(
  userId: string,
  wid: string,
  projectId?: string,
) {
  return Prisma.sql`WITH events AS MATERIALIZED (
      SELECT t.id AS "taskId",t."projectId",t.number,t.version AS "taskVersion",p.name AS "projectName",t.data->>'title' AS "taskTitle",(t.data->>'requirementVersion')::int AS "currentRequirementVersion",c.value,c.n
      FROM "Task" t JOIN "Project" p ON p.id=t."projectId"
      JOIN "WorkspaceMember" wm ON wm."workspaceId"=t."workspaceId" AND wm."userId"=${userId}
      JOIN "ProjectMember" pm ON pm."projectId"=t."projectId" AND pm."userId"=${userId}
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.data->'comments','[]'::jsonb)) WITH ORDINALITY c(value,n)
      WHERE t."workspaceId"=${wid} AND t."deletedAt" IS NULL AND p."archivedAt" IS NULL
      AND c.value->>'kind' IN ('QUESTION','QUESTION_STATE','QUESTION_ASSIGNMENT')
      ${projectId ? Prisma.sql`AND t."projectId"=${projectId}` : Prisma.empty}
    ), latest AS (
      SELECT DISTINCT ON ("taskId",value->>'replyTo',value->>'kind') "taskId",value
      FROM events WHERE value->>'replyTo' IS NOT NULL
      ORDER BY "taskId",value->>'replyTo',value->>'kind',n DESC
    ), questions AS (
      SELECT c."taskId",c."projectId",c.number,c."taskVersion",c."projectName",c."taskTitle",c."currentRequirementVersion",
      c.value->>'id' AS id, c.value->>'body' AS body, c.value->>'by' AS "createdBy", c.value->>'name' AS "createdByName", c.value->>'at' AS "createdAt",
      CASE WHEN a.value IS NULL THEN c.value->>'assigneeId' ELSE a.value->>'assigneeId' END AS "assigneeId",
      CASE WHEN a.value IS NULL THEN c.value->>'dueAt' ELSE a.value->>'dueAt' END AS "dueAt",
      COALESCE((st.value->>'resolved')::boolean,false) AS resolved,
      COALESCE(st.value->>'requirementVersion',c.value->>'requirementVersion')::int AS "checkedVersion"
      FROM events c
      LEFT JOIN latest a ON a."taskId"=c."taskId" AND a.value->>'replyTo'=c.value->>'id' AND a.value->>'kind'='QUESTION_ASSIGNMENT'
      LEFT JOIN latest st ON st."taskId"=c."taskId" AND st.value->>'replyTo'=c.value->>'id' AND st.value->>'kind'='QUESTION_STATE'
      WHERE c.value->>'kind'='QUESTION' AND c.value->>'replyTo' IS NULL
    )`;
}
