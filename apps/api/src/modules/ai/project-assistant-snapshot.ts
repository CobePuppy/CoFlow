import type { Task } from '@coflow/contracts/index.js';
import { planningContext } from '../goals/context.js';
import { assert } from '../requirements/domain.js';
import { assistantFingerprint, assistantSources } from './project-assistant.js';

export async function readAssistantSnapshot(tx: any, id: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id } });
  const tasks = await tx.task.findMany({
    where: {
      projectId: id,
      deletedAt: null,
      status: { notIn: ['CLOSED', 'CANCELLED'] },
    },
    orderBy: { id: 'asc' },
    take: 201,
  });
  assert(
    tasks.length <= 200,
    '推进助手暂支持最多200项未完成需求，请先缩小项目范围',
    422,
  );
  const members = await tx.projectMember.findMany({
    where: { projectId: id },
    orderBy: { userId: 'asc' },
  });
  const users = await tx.user.findMany({
    where: { id: { in: members.map((m: any) => m.userId) } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const sources = assistantSources(tasks as Task[]);
  const planning = await planningContext(tx, id);
  return {
    project: {
      id: p.id,
      name: p.name,
      description: p.description,
      archivedAt: p.archivedAt,
      workflow: p.workflow,
    },
    sources,
    planning,
    members: users,
    fingerprint: assistantFingerprint({
      p,
      tasks: tasks.map((t: any) => [t.id, t.version]),
      members,
      users,
      sources,
      planning,
    }),
  };
}
