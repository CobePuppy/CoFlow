import { assert } from '../requirements/domain.js';
import type { PlanningContext } from '@coflow/contracts/project-goals.js';

export async function planningContext(
  tx: any,
  projectId: string,
): Promise<PlanningContext> {
  const goals = await tx.projectGoal.findMany({
    where: { projectId },
    orderBy: { id: 'asc' },
    take: 101,
    select: {
      id: true,
      title: true,
      description: true,
      criteria: true,
      ownerId: true,
      dueDate: true,
      status: true,
      version: true,
    },
  });
  const iterations = await tx.iteration.findMany({
    where: { projectId },
    orderBy: { id: 'asc' },
    take: 201,
    select: {
      id: true,
      name: true,
      goal: true,
      ownerId: true,
      startDate: true,
      endDate: true,
      version: true,
    },
  });
  const actions = await tx.projectAction.findMany({
    where: { projectId },
    orderBy: { id: 'asc' },
    take: 501,
    select: {
      id: true,
      taskId: true,
      title: true,
      acceptance: true,
      status: true,
      ownerId: true,
      dueDate: true,
      version: true,
      outcome: true,
    },
  });
  assert(
    goals.length <= 100 && iterations.length <= 200 && actions.length <= 500,
    '目标工作台暂支持100项目标、200个迭代、500项行动；请先缩小项目范围',
    422,
  );
  const goalIds = goals.map((g: any) => g.id),
    iterationIds = iterations.map((i: any) => i.id);
  const goalTasks = await tx.projectGoalTask.findMany({
    where: { goalId: { in: goalIds } },
    orderBy: [{ goalId: 'asc' }, { taskId: 'asc' }],
  });
  const goalIterations = await tx.projectGoalIteration.findMany({
    where: { goalId: { in: goalIds } },
    orderBy: [{ goalId: 'asc' }, { iterationId: 'asc' }],
  });
  const milestones = await tx.iterationMilestone.findMany({
    take: 1001,
    where: { iterationId: { in: iterationIds } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      iterationId: true,
      name: true,
      goal: true,
      dueDate: true,
    },
  });
  const iterationTasks = await tx.iterationTask.findMany({
    take: 501,
    where: { iterationId: { in: iterationIds } },
    orderBy: { id: 'asc' },
    select: {
      iterationId: true,
      taskId: true,
      milestoneId: true,
      delayNote: true,
    },
  });
  assert(
    milestones.length <= 1000 && iterationTasks.length <= 500,
    '规划上下文最多支持1000个里程碑、500个迭代需求，请缩小项目范围',
    422,
  );
  return {
    goals,
    iterations,
    actions,
    goalTasks,
    goalIterations,
    milestones,
    iterationTasks,
  };
}
