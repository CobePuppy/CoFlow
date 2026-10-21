import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDiscussionUpdates,
  discussionRoots,
  discussionView,
  type Discussion,
} from '../../packages/contracts/src/discussion.js';
test('讨论筛选兼容历史评论，待解决问题排除回复，搜索回复返回原讨论', () => {
  const old = { id: 'old', body: '旧评论', by: 'u', name: '作者', at: '' };
  const rows: Discussion[] = [
    old,
    { ...old, id: 'q', kind: 'QUESTION' },
    { ...old, id: 'resolved', kind: 'QUESTION', resolved: true },
    { ...old, id: 'd', kind: 'DECISION' },
    { ...old, id: 'r', replyTo: 'q', body: 'Only REPLY' },
  ];
  assert.deepEqual(
    discussionRoots(rows, 'OPEN', '').map((c) => c.id),
    ['q'],
  );
  assert.deepEqual(
    discussionRoots(rows, 'DECISION', '').map((c) => c.id),
    ['d'],
  );
  assert.deepEqual(
    discussionRoots(rows, 'ALL', ' reply ').map((c) => c.id),
    ['q'],
  );
  assert.equal(discussionRoots(rows, 'ALL', '').length, 4);
});

test('问题状态从追加事件推导，不改写原评论，保留解决与重开原因', () => {
  const root: Discussion = {
    id: 'q',
    body: '问题',
    kind: 'QUESTION',
    by: 'u',
    name: '作者',
    at: '',
  };
  const rows: Discussion[] = [
    root,
    {
      ...root,
      id: 'a',
      kind: 'QUESTION_STATE',
      replyTo: 'q',
      body: '已明确',
      resolved: true,
    },
    {
      ...root,
      id: 'b',
      kind: 'QUESTION_STATE',
      replyTo: 'q',
      body: '范围变化',
      resolved: false,
    },
  ];
  assert.equal(discussionView(rows)[0].resolved, false);
  assert.equal(discussionView(rows)[0].resolutions?.length, 2);
  assert.equal(root.resolved, undefined);
  assert.equal(discussionView(rows.slice(0, 2))[0].resolved, true);
});

test('跟进转交与取消指派均按追加事件生效，保留原始记录和需求核对版本', () => {
  const root: Discussion = {
    id: 'q',
    body: '问题',
    kind: 'QUESTION',
    by: 'u',
    name: '作者',
    at: '',
    assigneeId: 'a',
    dueAt: '2000-01-01',
    requirementVersion: 1,
  };
  const rows: Discussion[] = [
    root,
    {
      ...root,
      id: 'a',
      kind: 'QUESTION_ASSIGNMENT',
      replyTo: 'q',
      assigneeId: 'b',
      dueAt: '2099-01-01',
      body: '转交',
    },
    {
      ...root,
      id: 'b',
      kind: 'QUESTION_ASSIGNMENT',
      replyTo: 'q',
      assigneeId: null,
      dueAt: null,
      body: '待分配',
    },
    {
      ...root,
      id: 's',
      kind: 'QUESTION_STATE',
      replyTo: 'q',
      resolved: true,
      requirementVersion: 2,
      body: '按新版本核对',
    },
  ];
  const q = discussionView(rows)[0];
  assert.equal(q.assigneeId, null);
  assert.equal(q.dueAt, null);
  assert.equal(q.assignments?.length, 2);
  assert.equal(q.checkedVersion, 2);
  assert.equal(root.assigneeId, 'a');
});

test('讨论增量追加保留顺序和状态，空增量不丢历史，重置与无效位置明确区分', () => {
  const comment: Discussion = {
    id: 'q',
    kind: 'QUESTION',
    body: '问题',
    by: 'a',
    name: '作者',
    at: '',
  };
  const initial = mergeDiscussionUpdates(undefined, {
    comments: [comment],
    from: 0,
    reset: true,
    total: 1,
    taskVersion: 2,
    requirementVersion: 1,
  });
  const state: Discussion = {
    ...comment,
    id: 'r',
    replyTo: 'q',
    kind: 'QUESTION_STATE',
    body: '已确认',
    resolved: true,
  };
  const updated = mergeDiscussionUpdates(initial, {
    comments: [state],
    from: 1,
    reset: false,
    total: 2,
    taskVersion: 3,
    requirementVersion: 1,
  });
  assert.equal(discussionView(updated.comments)[0].resolved, true);
  const unchanged = mergeDiscussionUpdates(updated, {
    comments: [],
    from: 2,
    reset: false,
    total: 2,
    taskVersion: 4,
    requirementVersion: 2,
  });
  assert.deepEqual(unchanged.comments, updated.comments);
  assert.equal(unchanged.requirementVersion, 2);
  assert.throws(() =>
    mergeDiscussionUpdates(updated, {
      comments: [state],
      from: 1,
      reset: false,
      total: 3,
      taskVersion: 4,
      requirementVersion: 2,
    }),
  );
  assert.throws(() =>
    mergeDiscussionUpdates(undefined, {
      comments: [],
      from: 0,
      reset: true,
      total: 1,
      taskVersion: 1,
      requirementVersion: 0,
    }),
  );
  assert.equal(
    mergeDiscussionUpdates(updated, {
      comments: [comment],
      from: 0,
      reset: true,
      total: 1,
      taskVersion: 5,
      requirementVersion: 2,
    }).comments.length,
    1,
  );
});

test('大量交错问题事件与旧版逐条计算一致，搜索状态原因、回复及取消指派均保留', () => {
  const rows: Discussion[] = [];
  for (let i = 0; i < 250; i++)
    rows.push({
      id: 'q' + i,
      kind: i % 2 ? 'QUESTION' : 'DECISION',
      body: '问题' + i,
      by: 'a',
      name: '作者',
      at: '',
      requirementVersion: 1,
      assigneeId: 'owner',
    });
  for (let round = 0; round < 3; round++)
    for (let i = 0; i < 250; i++)
      rows.push({
        id: 'e' + round + '-' + i,
        kind:
          round === 0
            ? 'COMMENT'
            : round === 1
              ? 'QUESTION_STATE'
              : 'QUESTION_ASSIGNMENT',
        replyTo: 'q' + i,
        body: '原因' + round + '-' + i,
        by: 'b',
        name: '回复人',
        at: '',
        resolved: i % 3 === 0,
        requirementVersion: 2,
        assigneeId: null,
        dueAt: null,
      });
  const old = rows.map((c) => {
    if (c.replyTo || c.kind !== 'QUESTION') return c;
    const events = rows.filter(
      (r) => r.replyTo === c.id && r.kind === 'QUESTION_STATE',
    );
    const assignments = rows.filter(
      (r) => r.replyTo === c.id && r.kind === 'QUESTION_ASSIGNMENT',
    );
    const last = assignments.at(-1);
    return {
      ...c,
      assigneeId: last ? last.assigneeId : c.assigneeId,
      dueAt: last ? last.dueAt : c.dueAt,
      checkedVersion: events.at(-1)?.requirementVersion ?? c.requirementVersion,
      assignments: assignments.map((r) => ({
        by: r.by,
        name: r.name,
        at: r.at,
        reason: r.body,
        assigneeId: r.assigneeId ?? null,
        dueAt: r.dueAt ?? null,
      })),
      resolved: events.at(-1)?.resolved || false,
      resolutions: events.map((r) => ({
        resolved: !!r.resolved,
        reason: r.body,
        by: r.by,
        name: r.name,
        at: r.at,
      })),
    };
  });
  const optimized = discussionView(rows);
  assert.deepEqual(optimized, old);
  for (const filter of ['ALL', 'OPEN', 'DECISION'])
    for (const query of [
      '',
      '原因0-2',
      '原因1-1',
      '原因2-24',
      '作者',
      '不存在',
    ]) {
      const search = query.toLocaleLowerCase();
      const expected = old.filter(
        (c) =>
          !c.replyTo &&
          (filter !== 'OPEN' || (c.kind === 'QUESTION' && !c.resolved)) &&
          (filter !== 'DECISION' || c.kind === 'DECISION') &&
          (!search ||
            [c, ...old.filter((r) => r.replyTo === c.id)].some((r) =>
              (r.body + ' ' + r.name).toLocaleLowerCase().includes(search),
            )),
      );
      assert.deepEqual(discussionRoots(optimized, filter, query), expected);
    }
});
