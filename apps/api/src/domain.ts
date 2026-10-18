import { isOverdue } from '../../../packages/contracts/deadline.js';
import { randomUUID } from 'node:crypto';
import {
  terminal,
  type Task,
  type Member,
  type Status,
} from '../../../packages/contracts/index.js';
export class BusinessError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'BUSINESS_RULE',
  ) {
    super(message);
  }
}
export function assert(ok: unknown, message: string, status = 422): asserts ok {
  if (!ok) throw new BusinessError(status, message);
}
export function required(p: any, keys: string[]) {
  for (const k of keys)
    assert(typeof p[k] === 'string' && p[k].trim().length > 0, `${k} 不能为空`);
}
export const handlers = (t: Task): string[] => {
  if (t.deletedAt) return [];
  const d = t.data;
  switch (t.status) {
    case 'DRAFT':
    case 'ACCEPTANCE_PENDING':
      return [d.productId];
    case 'SOLUTION_REVIEW':
      return [d.productReviewerId, d.qaReviewerId].filter(
        (id) =>
          !d.reviews.some(
            (r) => r.round === d.solutions.length && r.userId === id,
          ),
      );
    case 'READY_FOR_TEST':
    case 'TESTING':
      return [d.testerId];
    case 'CLOSED':
    case 'CANCELLED':
      return [];
    default:
      return [d.engineerId];
  }
};
export function allowedActions(t: Task, user: Member, admin = false): string[] {
  if (terminal(t.status) || t.deletedAt) return [];
  const d = t.data,
    result: string[] = [],
    product = user.id === d.productId,
    engineer = user.id === d.engineerId,
    tester = user.id === d.testerId;
  if (d.workflow === 'SIMPLE') {
    if (product || admin) result.push('TRANSFER');
    if (product) {
      result.push('CANCEL');
      if (t.status === 'DRAFT') result.unshift('SUBMIT_REQUIREMENT');
      if (t.status === 'ACCEPTANCE_PENDING')
        result.unshift('ACCEPT', 'REJECT_ACCEPTANCE');
    }
    if (engineer && t.status === 'READY_FOR_DEV') result.unshift('START_WORK');
    if (engineer && t.status === 'DEVELOPING')
      result.unshift('SUBMIT_ACCEPTANCE');
    if (product || handlers(t).includes(user.id))
      result.push(d.blocks.some((b) => !b.end) ? 'UNBLOCK' : 'BLOCK');
    return d.blocks.some((b) => !b.end)
      ? result.filter((a) =>
          ['TRANSFER', 'CANCEL', 'UNBLOCK', 'REJECT_ACCEPTANCE'].includes(a),
        )
      : result;
  }
  if (admin && !product) result.push('TRANSFER');
  if (product) {
    result.push('TRANSFER', 'CANCEL');
    if (t.status === 'DRAFT') result.unshift('SUBMIT_REQUIREMENT');
    else result.push('APPLY_REQUIREMENT_CHANGE');
    if (t.status === 'ACCEPTANCE_PENDING')
      result.unshift('ACCEPT', 'REJECT_ACCEPTANCE');
  }
  if (engineer) {
    if (t.status === 'SOLUTION_PENDING')
      result.unshift('SUBMIT_SOLUTION', 'RETURN_REQUIREMENT');
    if (t.status === 'READY_FOR_DEV') result.unshift('START_DEVELOPMENT');
    if (t.status === 'DEVELOPING') result.unshift('COMPLETE_DEVELOPMENT');
  }
  const slot =
    user.id === d.productReviewerId
      ? 'PRODUCT'
      : user.id === d.qaReviewerId
        ? 'QA'
        : null;
  if (
    t.status === 'SOLUTION_REVIEW' &&
    slot &&
    d.solutions.at(-1)?.by !== user.id &&
    !d.reviews.some((r) => r.round === d.solutions.length && r.slot === slot)
  )
    result.unshift('APPROVE_SOLUTION', 'REJECT_SOLUTION');
  if (tester) {
    if (t.status === 'READY_FOR_TEST') result.unshift('START_TEST');
    if (t.status === 'TESTING') result.unshift('PASS_TEST', 'FAIL_TEST');
  }
  const blocked = d.blocks.some((b) => !b.end);
  if (product || handlers(t).includes(user.id))
    result.push(blocked ? 'UNBLOCK' : 'BLOCK');
  return blocked
    ? result.filter((a) =>
        [
          'RETURN_REQUIREMENT',
          'REJECT_SOLUTION',
          'FAIL_TEST',
          'REJECT_ACCEPTANCE',
          'APPLY_REQUIREMENT_CHANGE',
          'CANCEL',
          'UNBLOCK',
          'TRANSFER',
        ].includes(a),
      )
    : result;
}
export function validateOwners(d: Task['data'], members: Member[]) {
  const has = (id: string) => members.some((m) => m.id === id);
  if (d.workflow === 'SIMPLE') {
    assert(
      has(d.productId) && has(d.engineerId),
      '请指定项目内的需求负责人和执行人',
    );
    return;
  }
  assert(
    has(d.productId) &&
      has(d.engineerId) &&
      has(d.productReviewerId) &&
      has(d.qaReviewerId) &&
      has(d.testerId),
    '责任人必须属于当前项目',
  );
  assert(
    d.productReviewerId !== d.qaReviewerId,
    '产品与测试评估人必须为不同账号',
  );
  assert(
    d.engineerId !== d.productReviewerId && d.engineerId !== d.qaReviewerId,
    '方案提交人不能审批自己的方案',
  );
}
export function execute(
  original: Task,
  action: string,
  p: any,
  user: Member,
  members: Member[],
  now = new Date().toISOString(),
  admin = false,
): Task {
  const t = structuredClone(original),
    d = t.data,
    from = t.status;
  assert(!terminal(t.status), '终态任务不能修改');
  assert(!t.deletedAt, '需求已移入回收站，请先恢复', 409);
  if (d.workflow === 'SIMPLE')
    assert(
      allowedActions(t, user, admin).includes(action),
      '当前阶段或身份不能执行此操作',
      403,
    );
  assert(
    members.some((m) => m.id === user.id),
    '不是项目成员',
    403,
  );
  const own = (id: string) => assert(user.id === id, '无权执行此操作', 403);
  const at = (...s: Status[]) =>
    assert(s.includes(t.status), '当前阶段不能执行此操作', 409);
  const reason = () => required(p, ['reason']);
  const blocked = d.blocks.some((b) => !b.end);
  if (
    blocked &&
    ![
      'RETURN_REQUIREMENT',
      'REJECT_SOLUTION',
      'FAIL_TEST',
      'REJECT_ACCEPTANCE',
      'APPLY_REQUIREMENT_CHANGE',
      'CANCEL',
      'UNBLOCK',
      'TRANSFER',
    ].includes(action)
  )
    assert(false, '任务已阻塞，请先解除阻塞', 409);
  switch (action) {
    case 'SUBMIT_REQUIREMENT':
      at('DRAFT');
      own(d.productId);
      required(
        d,
        d.workflow === 'SIMPLE'
          ? ['title', 'description']
          : ['title', 'background', 'goal', 'description'],
      );
      assert(
        d.criteria.length && d.criteria.every((x) => x.trim()),
        '至少填写一项验收标准',
      );
      validateOwners(d, members);
      d.requirementVersion++;
      d.requirements.push({
        version: d.requirementVersion,
        at: now,
        by: user.id,
        title: d.title,
        background: d.background,
        goal: d.goal,
        description: d.description,
        criteria: [...d.criteria],
      });
      t.status = d.workflow === 'SIMPLE' ? 'READY_FOR_DEV' : 'SOLUTION_PENDING';
      break;
    case 'START_WORK':
      assert(d.workflow === 'SIMPLE', '此操作仅适用于简易流程');
      at('READY_FOR_DEV');
      own(d.engineerId);
      t.status = 'DEVELOPING';
      break;
    case 'SUBMIT_ACCEPTANCE':
      assert(d.workflow === 'SIMPLE', '此操作仅适用于简易流程');
      at('DEVELOPING');
      own(d.engineerId);
      required(p, ['summary']);
      d.development.push({ summary: p.summary, by: user.id, at: now });
      t.status = 'ACCEPTANCE_PENDING';
      break;
    case 'RETURN_REQUIREMENT':
      at('SOLUTION_PENDING');
      own(d.engineerId);
      reason();
      t.status = 'DRAFT';
      break;
    case 'SUBMIT_SOLUTION':
      at('SOLUTION_PENDING');
      own(d.engineerId);
      validateOwners(d, members);
      required(p, ['body', 'scope', 'risk', 'start', 'end']);
      assert(
        Number.isFinite(Number(p.effort)) && Number(p.effort) > 0,
        '工作量必须为有限正数',
      );
      assert(
        Number.isFinite(Date.parse(p.start)) &&
          Number.isFinite(Date.parse(p.end)) &&
          Date.parse(p.end) >= Date.parse(p.start),
        '方案排期无效',
      );
      d.solutions.push({
        ...p,
        version: d.solutions.length + 1,
        requirementVersion: d.requirementVersion,
        by: user.id,
        at: now,
      });
      delete (d as any).solutionDraft;
      delete d.reviewSnapshot;
      t.status = 'SOLUTION_REVIEW';
      break;
    case 'APPROVE_SOLUTION':
    case 'REJECT_SOLUTION': {
      at('SOLUTION_REVIEW');
      const slot =
        user.id === d.productReviewerId
          ? 'PRODUCT'
          : user.id === d.qaReviewerId
            ? 'QA'
            : null;
      assert(slot, '不是指定评估人', 403);
      assert(user.id !== d.solutions.at(-1).by, '禁止审批自己提交的方案', 403);
      assert(
        !d.reviews.some(
          (r) => r.round === d.solutions.length && r.slot === slot,
        ),
        '本槽位已评估',
        409,
      );
      if (action === 'REJECT_SOLUTION') reason();
      d.reviews.push({
        round: d.solutions.length,
        requirementVersion: d.requirementVersion,
        slot,
        userId: user.id,
        approved: action === 'APPROVE_SOLUTION',
        reason: p.reason || '',
        at: now,
      });
      if (action === 'REJECT_SOLUTION') {
        t.status = 'SOLUTION_PENDING';
        delete d.reviewSnapshot;
      } else if (
        d.reviews.filter((r) => r.round === d.solutions.length && r.approved)
          .length === 2
      ) {
        d.reviewSnapshot = {
          requirementVersion: d.requirementVersion,
          solutionVersion: d.solutions.length,
          decisions: structuredClone(
            d.reviews.filter((r) => r.round === d.solutions.length),
          ),
          at: now,
        };
        t.status = 'READY_FOR_DEV';
      }
      break;
    }
    case 'START_DEVELOPMENT':
      at('READY_FOR_DEV');
      own(d.engineerId);
      assert(
        d.reviewSnapshot?.requirementVersion === d.requirementVersion &&
          d.reviewSnapshot?.solutionVersion === d.solutions.length,
        '评估快照已失效',
      );
      t.status = 'DEVELOPING';
      break;
    case 'COMPLETE_DEVELOPMENT':
      at('DEVELOPING');
      own(d.engineerId);
      required(p, [
        'summary',
        'selfTest',
        'releaseVersion',
        'environment',
        'knownIssues',
      ]);
      d.development.push({
        ...p,
        at: now,
        by: user.id,
        round: d.tests.length + 1,
      });
      d.tests.push({
        round: d.tests.length + 1,
        status: 'PENDING',
        at: now,
        submission: d.development.length,
      });
      t.status = 'READY_FOR_TEST';
      break;
    case 'START_TEST':
      at('READY_FOR_TEST');
      own(d.testerId);
      required(p, ['environment']);
      Object.assign(d.tests.at(-1), {
        status: 'TESTING',
        environment: p.environment,
        startedAt: now,
      });
      t.status = 'TESTING';
      break;
    case 'FAIL_TEST':
    case 'PASS_TEST':
      at('TESTING');
      own(d.testerId);
      required(p, ['record', 'deployment']);
      if (action === 'FAIL_TEST') {
        reason();
        assert(
          Array.isArray(p.defectIds) && p.defectIds.length,
          '测试失败必须关联缺陷',
        );
        t.status = 'DEVELOPING';
      } else t.status = 'ACCEPTANCE_PENDING';
      Object.assign(d.tests.at(-1), {
        ...p,
        status: action === 'FAIL_TEST' ? 'FAILED' : 'PASSED',
        by: user.id,
        completedAt: now,
      });
      break;
    case 'ACCEPT':
      at('ACCEPTANCE_PENDING');
      own(d.productId);
      assert(
        Array.isArray(p.checks) &&
          p.checks.length === d.criteria.length &&
          p.checks.every((v: any) => v === true),
        '必须逐项通过验收标准',
      );
      d.acceptances.push({
        ...p,
        requirementVersion: d.requirementVersion,
        at: now,
        by: user.id,
      });
      t.status = 'CLOSED';
      break;
    case 'REJECT_ACCEPTANCE':
      at('ACCEPTANCE_PENDING');
      own(d.productId);
      reason();
      if (d.workflow === 'SIMPLE') {
        t.status = 'DEVELOPING';
        break;
      }
      assert(
        ['DEVELOPING', 'READY_FOR_TEST'].includes(p.target),
        '请选择退回去向',
      );
      t.status = p.target;
      if (p.target === 'READY_FOR_TEST')
        d.tests.push({
          round: d.tests.length + 1,
          status: 'PENDING',
          at: now,
          submission: d.development.length,
        });
      break;
    case 'APPLY_REQUIREMENT_CHANGE':
      assert(t.status !== 'DRAFT', '草稿请直接编辑');
      own(d.productId);
      required(p, ['reason', 'impact', 'description']);
      assert(
        Array.isArray(p.criteria) &&
          p.criteria.length &&
          p.criteria.every((x: any) => typeof x === 'string' && x.trim()),
        '变更必须填写验收标准',
      );
      d.changes.push({ ...p, at: now, by: user.id, decision: 'CONFIRMED' });
      d.description = p.description;
      d.criteria = p.criteria;
      d.requirementVersion++;
      d.requirements.push({
        version: d.requirementVersion,
        at: now,
        by: user.id,
        title: d.title,
        background: d.background,
        goal: d.goal,
        description: d.description,
        criteria: [...d.criteria],
      });
      delete d.reviewSnapshot;
      delete (d as any).solutionDraft;
      if (
        d.tests.at(-1) &&
        ['PENDING', 'TESTING'].includes(d.tests.at(-1).status)
      )
        d.tests.at(-1).status = 'VOID';
      t.status = 'SOLUTION_PENDING';
      break;
    case 'BLOCK':
      assert(
        user.id === d.productId || handlers(t).includes(user.id),
        '仅当前处理人或产品负责人可阻塞',
        403,
      );
      reason();
      assert(!blocked, '已阻塞');
      d.blocks.push({
        id: randomUUID(),
        reason: p.reason,
        start: now,
        by: user.id,
      });
      break;
    case 'UNBLOCK':
      assert(
        user.id === d.productId || handlers(t).includes(user.id),
        '无权解除阻塞',
        403,
      );
      reason();
      assert(blocked, '当前没有阻塞');
      Object.assign(
        d.blocks.find((b) => !b.end),
        { end: now, resolvedBy: user.id, resolution: p.reason },
      );
      break;
    case 'TRANSFER':
      if (!admin) own(d.productId);
      p.reason = p.reason?.trim() || '调整需求责任分工';
      for (const key of [
        'productId',
        'engineerId',
        'productReviewerId',
        'qaReviewerId',
        'testerId',
      ])
        if (p[key]) {
          assert(
            t.status !== 'SOLUTION_REVIEW' ||
              !['productReviewerId', 'qaReviewerId'].includes(key),
            '评估期间不可更换评估人',
          );
          (d as any)[key] = p[key];
        }
      if (t.status === 'DRAFT') {
        for (const id of [
          d.productId,
          d.engineerId,
          d.productReviewerId,
          d.qaReviewerId,
          d.testerId,
        ])
          if (id)
            assert(
              members.some((m) => m.id === id),
              '责任人必须属于当前项目',
            );
      } else validateOwners(d, members);
      break;
    case 'CANCEL':
      own(d.productId);
      reason();
      if (
        d.tests.at(-1) &&
        ['PENDING', 'TESTING'].includes(d.tests.at(-1).status)
      )
        d.tests.at(-1).status = 'VOID';
      t.status = 'CANCELLED';
      break;
    default:
      throw new BusinessError(422, '未知业务动作');
  }
  if (terminal(t.status)) for (const b of d.blocks) if (!b.end) b.end = now;
  d.history.push({
    id: randomUUID(),
    at: now,
    actor: user.id,
    name: user.name,
    action,
    from,
    to: t.status,
    payload: p,
  });
  t.version++;
  t.updatedAt = now;
  return t;
}
export function metrics(tasks: Task[], now = Date.now()) {
  return tasks.map((t) => {
    const stages: Record<string, { totalHours: number; netHours: number }> = {};
    let state: Status = 'DRAFT',
      start = Date.parse(t.createdAt);
    const events = [
      ...t.data.history.filter((h) => h.from !== h.to),
      { at: new Date(now).toISOString(), to: t.status },
    ];
    for (const event of events) {
      const end = Date.parse(event.at);
      if (!terminal(state)) {
        const blocks = t.data.blocks
          .map((b) => [
            Math.max(start, Date.parse(b.start)),
            Math.min(end, b.end ? Date.parse(b.end) : now),
          ])
          .filter(([a, b]) => b > a)
          .sort((a, b) => a[0] - b[0]);
        let overlap = 0,
          last = start;
        for (const [a, b] of blocks) {
          overlap += Math.max(0, b - Math.max(last, a));
          last = Math.max(last, b);
        }
        const s = (stages[state] ??= { totalHours: 0, netHours: 0 });
        s.totalHours += (end - start) / 3600000;
        s.netHours += Math.max(0, end - start - overlap) / 3600000;
      }
      state = event.to;
      start = end;
    }
    const first = t.data.history.find((h) => h.action === 'SUBMIT_REQUIREMENT'),
      closed = t.data.history.find((h) => h.action === 'ACCEPT');
    return {
      id: t.id,
      title: t.data.title,
      status: t.status,
      stages,
      solutionReturns: t.data.history.filter(
        (h) => h.action === 'REJECT_SOLUTION',
      ).length,
      testReturns: t.data.history.filter((h) => h.action === 'FAIL_TEST')
        .length,
      overdue: !terminal(t.status) && isOverdue(t.data.dueAt, now),
      deliveryHours:
        first && closed
          ? (Date.parse(closed.at) - Date.parse(first.at)) / 3600000
          : null,
    };
  });
}
