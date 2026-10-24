import { z } from 'zod';
import { discussionView } from './discussion.js';
import { labels, type Task } from './index.js';
import { isOverdue } from './deadline.js';

export const actionFilters = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  q: z.string().trim().max(200).default(''),
  scope: z.enum(['ALL', 'MINE', 'REVIEW', 'OVERDUE']).default('ALL'),
  status: z.enum(['ALL', 'OPEN', 'DOING', 'SUBMITTED', 'DONE']).default('ALL'),
});
export function matchesAction(
  a: {
    title: string;
    acceptance: string;
    ownerId: string | null;
    dueDate: string | null;
    status: string;
    canReview?: boolean;
    unavailable?: boolean;
    taskNumber?: number;
    taskTitle?: string;
  },
  filters: z.infer<typeof actionFilters>,
  userId: string,
  ownerName = '',
  now = Date.now(),
) {
  if (filters.status !== 'ALL' && a.status !== filters.status) return false;
  if (filters.scope === 'MINE' && a.ownerId !== userId) return false;
  if (
    filters.scope === 'REVIEW' &&
    !(
      a.status === 'SUBMITTED' &&
      a.canReview &&
      a.ownerId !== userId &&
      !a.unavailable
    )
  )
    return false;
  if (
    filters.scope === 'OVERDUE' &&
    !(a.status !== 'DONE' && isOverdue(a.dueDate || undefined, now))
  )
    return false;
  return [
    a.title,
    a.acceptance,
    a.taskTitle || '',
    'CF-' + a.taskNumber,
    'CF-' + String(a.taskNumber).padStart(3, '0'),
    ownerName,
  ]
    .join(' ')
    .toLocaleLowerCase()
    .includes(filters.q.toLocaleLowerCase());
}

export const actionCreate = z
  .object({
    taskId: z.string().min(1),
    expectedTaskVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(1000),
    acceptance: z.string().trim().min(1).max(1000),
    evidence: z.string().min(2).max(1000),
    planFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const actionChange = z
  .object({
    expectedVersion: z.number().int().positive(),
    expectedTaskVersion: z.number().int().positive(),
    operation: z.enum([
      'CLAIM',
      'ASSIGN',
      'SUBMIT',
      'ACCEPT',
      'RETURN',
      'REOPEN',
      'RESCHEDULE',
    ]),
    ownerId: z.string().min(1).optional(),
    dueDate: z.union([z.iso.date(), z.null()]).optional(),
    note: z.string().trim().min(1).max(4000),
  })
  .strict();
export const actionStatusLabels: Record<string, string> = {
  OPEN: '待认领',
  DOING: '进行中',
  SUBMITTED: '待确认',
  DONE: '已确认完成',
};
export function deliveryChecks(t: Task) {
  const d = t.data;
  const simple = d.workflow === 'SIMPLE';
  const questions = discussionView(d.comments || []).filter(
    (c) => !c.replyTo && c.kind === 'QUESTION' && !c.resolved,
  );
  const handoff = d.development.at(-1);
  const latestTest = d.tests.at(-1);
  const check = (key: string, label: string, ok: boolean, detail: string) => ({
    key,
    label,
    ok,
    detail,
  });
  return [
    check(
      'criteria',
      '验收标准',
      !!d.criteria.length && d.criteria.every((c) => !!c.trim()),
      d.criteria.length + ' 项；需人工核对可验证性',
    ),
    check(
      'blocks',
      '阻塞情况',
      !d.blocks.some((b) => !b.end),
      d.blocks
        .filter((b) => !b.end)
        .map((b) => b.reason)
        .join('；') || '无记录',
    ),
    check(
      'questions',
      '澄清问题',
      !questions.length,
      questions.length + ' 项未解决',
    ),
    ...(simple
      ? []
      : [
          check(
            'handoff',
            '研发交接',
            !!handoff?.summary?.trim() && !!handoff?.selfTest?.trim(),
            handoff ? '核对最新交接与自测记录' : '缺少交接记录',
          ),
          check(
            'test',
            '当前轮次测试',
            !!handoff &&
              latestTest?.status === 'PASSED' &&
              latestTest?.submission === d.development.length &&
              !!latestTest?.record?.trim(),
            '须有当前交接轮次的通过记录及测试说明',
          ),
        ]),
  ];
}
export type ProgressSnapshot = {
  tasks: {
    id: string;
    number: number;
    title: string;
    status: string;
    version: number;
    deleted: boolean;
  }[];
  actions: { id: string; title: string; status: string; version: number }[];
};
export function checkpointFollowUps(
  previous: ProgressSnapshot | null,
  current: ProgressSnapshot,
) {
  const result: string[] = [];
  for (const [status, message] of [
    ['OPEN', '项行动待认领，请明确负责人和截止日'],
    ['DOING', '项行动正在执行，请由负责人提交可核对的成果'],
    ['SUBMITTED', '项成果待确认，请由负责人以外的产品成员或管理员核对'],
  ]) {
    const count = current.actions.filter((a) => a.status === status).length;
    if (count) result.push(count + ' ' + message);
  }
  if (!current.actions.length)
    result.push('当前没有行动，请先确认哪些推进建议需要转入执行。');
  else if (current.actions.every((a) => a.status === 'DONE'))
    result.push('当前行动均已确认完成，请继续核对对应需求的正式验收状态。');
  if (previous && !compareCheckpoints(previous, current).changes.length)
    result.push('与对比检查点暂无变化，请核对本轮成果是否尚未记录。');
  return result;
}
export function compareCheckpoints(
  previous: ProgressSnapshot | null,
  current: ProgressSnapshot,
) {
  if (!previous)
    return {
      baseline: false,
      changes: [] as {
        kind: string;
        id: string;
        title: string;
        change: string;
      }[],
    };
  const changes: { kind: string; id: string; title: string; change: string }[] =
    [];
  for (const kind of ['tasks', 'actions'] as const) {
    const old = new Map(previous[kind].map((item) => [item.id, item]));
    for (const item of current[kind]) {
      const before = old.get(item.id);
      const deleted = 'deleted' in item && item.deleted;
      const wasDeleted = before && 'deleted' in before && before.deleted;
      if (!before)
        changes.push({
          kind,
          id: item.id,
          title: item.title,
          change: deleted ? '新增记录已移入回收站' : '新增',
        });
      else if (deleted !== !!wasDeleted)
        changes.push({
          kind,
          id: item.id,
          title: item.title,
          change: deleted ? '移入回收站' : '已恢复',
        });
      else if (before.status !== item.status)
        changes.push({
          kind,
          id: item.id,
          title: item.title,
          change: before.status + ' → ' + item.status,
        });
      else if (before.version !== item.version)
        changes.push({
          kind,
          id: item.id,
          title: item.title,
          change: '资料更新，阶段未变化',
        });
      old.delete(item.id);
    }
    for (const item of old.values())
      changes.push({
        kind,
        id: item.id,
        title: item.title,
        change: '不在当前项目，需核对',
      });
  }
  return { baseline: true, changes };
}

export function progressBrief(input: {
  projectName: string;
  asOf: string;
  baseline: {
    id: string;
    note: string;
    createdAt: string;
    snapshot: ProgressSnapshot;
  } | null;
  current: ProgressSnapshot;
  actions: {
    title: string;
    status: string;
    ownerName: string;
    dueDate: string | null;
    taskNumber?: number;
    outcome: string;
  }[];
}) {
  const clean = (value: unknown) =>
    String(value ?? '')
      .replace(/[\r\n]/g, ' ')
      .replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
  const comparison = compareCheckpoints(
    input.baseline?.snapshot || null,
    input.current,
  );
  const time = (value: string) =>
    new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const changeLabel = (text: string) =>
    text
      .split(' → ')
      .map(
        (v) => labels[v as keyof typeof labels] || actionStatusLabels[v] || v,
      )
      .join(' → ');
  return [
    '# 项目推进简报',
    '',
    '项目：' + clean(input.projectName),
    '数据读取时间（北京时间）：' + time(input.asOf),
    '> 这是记录与状态对比，不代表已执行测试、完成需求验收或承诺交付日期。',
    '',
    '## 对比基线',
    input.baseline
      ? clean(input.baseline.note) +
        ' · ' +
        time(input.baseline.createdAt) +
        '（北京时间）' +
        ' · ID ' +
        clean(input.baseline.id)
      : '尚无检查点，以下仅记录当前状态。',
    '',
    '## 状态变化',
    ...comparison.changes.map(
      (c) =>
        '- ' +
        (c.kind === 'tasks' ? '需求' : '行动') +
        '：' +
        clean(c.title) +
        ' · ' +
        clean(changeLabel(c.change)),
    ),
    ...(comparison.changes.length
      ? []
      : [
          comparison.baseline
            ? '与所选基线相比暂无变化。'
            : '建立检查点后可比较变化。',
        ]),
    '',
    '## 全项目行动（' + input.actions.length + '项，独立于页面筛选）',
    ...input.actions.flatMap((a) => [
      '',
      '- ' + clean(a.title) + ' · ' + actionStatusLabels[a.status],
      '  - 负责人：' +
        clean(a.ownerName) +
        '；截止日（北京时间）：' +
        (a.dueDate || '未设置') +
        '；来源 CF-' +
        a.taskNumber,
      '  - ' +
        (['SUBMITTED', 'DONE'].includes(a.status)
          ? '提交成果'
          : '上次提交成果') +
        '：' +
        clean(a.outcome || '未提交'),
    ]),
    '',
    '## 下一步跟进',
    ...checkpointFollowUps(input.baseline?.snapshot || null, input.current).map(
      (t) => '- ' + t,
    ),
  ].join('\n');
}
