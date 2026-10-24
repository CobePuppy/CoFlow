import { createHash } from 'node:crypto';
import { projectPlanSchema } from '@coflow/contracts/project-assistant.js';
import { getHandlerIds, terminal, type Task } from '@coflow/contracts/index.js';
import { isOverdue } from '@coflow/contracts/deadline.js';
import { assert } from '../requirements/domain.js';

export function assistantSources(tasks: Task[], now = Date.now()) {
  return tasks
    .filter((t) => !t.deletedAt && !terminal(t.status))
    .map((t) => {
      const d = t.data;
      const signals: string[] = [];
      if (d.blocks.some((b) => !b.end)) signals.push('存在未解除阻塞');
      if (isOverdue(d.dueAt, now)) signals.push('已逾期');
      if (!d.criteria.some((c) => c.trim())) signals.push('缺少验收标准');
      if (t.status === 'ACCEPTANCE_PENDING') signals.push('等待产品验收');
      if (
        ['READY_FOR_TEST', 'TESTING'].includes(t.status) &&
        !d.development.length
      )
        signals.push('缺少研发交接记录');
      return {
        id: t.id,
        number: t.number,
        version: t.version,
        status: t.status,
        title: d.title,
        handlerIds: [...new Set(getHandlerIds(t).filter(Boolean))],
        signals,
        text: JSON.stringify({
          title: d.title,
          goal: d.goal,
          dueAt: d.dueAt,
          criteria: d.criteria,
          priority: d.priority,
          blocks: d.blocks
            .filter((b) => !b.end)
            .map((b) => ({ reason: b.reason })),
          handoff: d.development.at(-1)
            ? {
                summary: d.development.at(-1).summary,
                selfTest: d.development.at(-1).selfTest,
                knownIssues: d.development.at(-1).knownIssues,
              }
            : null,
          test: d.tests.at(-1)
            ? { status: d.tests.at(-1).status, record: d.tests.at(-1).record }
            : null,
        }),
      };
    });
}
export function assistantFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function validateProjectPlan(
  raw: unknown,
  sources: ReturnType<typeof assistantSources>,
) {
  const parsed = projectPlanSchema.safeParse(raw);
  assert(parsed.success, 'AI行动计划格式不完整，请重试', 502);
  const seen = new Set<string>();
  for (const action of parsed.data.actions) {
    const source = sources.find((s) => s.id === action.taskId);
    assert(
      source && source.text.includes(action.evidence),
      'AI行动依据无法核对，请重试',
      502,
    );
    assert(!seen.has(action.taskId), 'AI重复列出同一需求，请重试', 502);
    seen.add(action.taskId);
  }
  return parsed.data;
}
