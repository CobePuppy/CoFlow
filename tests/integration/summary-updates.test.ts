import { Prisma } from '@prisma/client';
import fs from 'node:fs';
import { statuses } from '../../packages/contracts/src/index.js';
import { mergeDiscussionUpdates } from '../../packages/contracts/src/discussion.js';
import { questionEvents } from '../../apps/api/src/modules/requirements/discussion-sql.js';
import 'dotenv/config';
import { discussionView } from '../../packages/contracts/src/discussion.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
test('首页摘要与讨论增量：旧接口对照、历史事件、读取体积和权限', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3113/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3113',
        APP_ORIGIN: origin,
        STORAGE_DIR: './storage-test',
        COFLOW_IMPORT_ONLY: '',
      },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stderr.on('data', (b) => (output += b.toString()));
  async function send(route: string, method = 'GET', data?: any, a?: any) {
    const r = await fetch(base + route, {
      method,
      headers: {
        Origin: origin,
        ...(data instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(a ? { Cookie: a.cookie, 'X-CSRF-Token': a.csrf } : {}),
      },
      ...(data === undefined
        ? {}
        : { body: data instanceof FormData ? data : JSON.stringify(data) }),
    });
    const text = await r.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: r.status, data: body, headers: r.headers };
  }
  async function register(tag: string) {
    const email = 'summary-' + randomUUID() + '@example.com',
      password = 'Refs-test-2026!';
    const reg = await send('/auth/register', 'POST', {
      kind: 'creator',
      name: tag,
      email,
      password,
      teamName: '引用团队' + tag,
    });
    assert.equal(reg.status, 201);
    const r = await send('/auth/login', 'POST', { email, password });
    return {
      ...r.data,
      workspaceId: reg.data.workspaceId,
      cookie: r.headers.get('set-cookie')!.split(';')[0],
    };
  }
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + '/health')).ok) break;
      } catch {}
      assert(i < 100, output);
      await new Promise((r) => setTimeout(r, 100));
    }

    const a = await register('摘要A'),
      b = await register('摘要B');
    const p = (
      await send(
        '/workspaces/' + a.workspaceId + '/projects',
        'POST',
        { name: '摘要项目', workflow: 'SIMPLE' },
        a,
      )
    ).data;
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: b.user.id, role: 'MEMBER' },
    });
    await db.projectMember.create({
      data: { projectId: p.id, userId: b.user.id, roles: ['ENGINEER'] },
    });
    const seed = (
      await send(
        '/projects/' + p.id + '/tasks',
        'POST',
        { title: '摘要需求', productId: a.user.id, engineerId: a.user.id },
        a,
      )
    ).data;
    const comments: any[] = [];
    for (let i = 0; i < 120; i++)
      comments.push({
        id: randomUUID(),
        kind: 'QUESTION',
        body: '澄清问题' + i + ' 内容'.repeat(100),
        by: a.user.id,
        name: '作者',
        at: new Date(1000 + i).toISOString(),
        assigneeId: a.user.id,
        dueAt: '2000-01-01',
        requirementVersion: 0,
      });
    for (let i = 0; i < 120; i++)
      comments.push({
        id: randomUUID(),
        replyTo: comments[i].id,
        kind: i % 2 ? 'QUESTION_ASSIGNMENT' : 'QUESTION_STATE',
        body: '变更记录',
        by: a.user.id,
        name: '作者',
        at: new Date(2000 + i).toISOString(),
        assigneeId: null,
        dueAt: null,
        resolved: true,
        requirementVersion: 0,
      });
    for (let i = 0; i < statuses.length; i++)
      await db.task.create({
        data: {
          workspaceId: a.workspaceId,
          projectId: p.id,
          number: 100 + i,
          status: statuses[i],
          data: {
            ...seed.data,
            title: '状态' + statuses[i],
            description: '大段历史材料'.repeat(5000),
            priority: 'P1',
            dueAt: '2000-01-01T00:00:00.000Z',
            testerId: a.user.id,
            productReviewerId: a.user.id,
            qaReviewerId: b.user.id,
            solutions: [{}],
            reviews: [],
            blocks: [
              { reason: '仍需外部确认', start: '2000-01-01' },
              { reason: '已解除', start: '2000-01-01', end: '2000-01-02' },
            ],
            comments,
          },
        },
      });
    await db.task.create({
      data: {
        workspaceId: a.workspaceId,
        projectId: p.id,
        number: 200,
        status: 'SOLUTION_REVIEW',
        data: {
          ...seed.data,
          productReviewerId: a.user.id,
          qaReviewerId: b.user.id,
          solutions: [{}],
          reviews: [{ userId: a.user.id, round: 1 }],
        },
      },
    });
    await db.task.create({
      data: {
        workspaceId: a.workspaceId,
        projectId: p.id,
        number: 201,
        status: 'SOLUTION_REVIEW',
        data: {
          ...seed.data,
          productReviewerId: a.user.id,
          qaReviewerId: b.user.id,
          solutions: [{}, {}],
          reviews: [{ userId: a.user.id, round: 1 }],
        },
      },
    });
    await db.task.create({
      data: {
        workspaceId: a.workspaceId,
        projectId: p.id,
        number: 202,
        deletedAt: new Date(),
        data: seed.data,
      },
    });
    await db.competition.create({
      data: {
        workspaceId: a.workspaceId,
        projectId: p.id,
        name: '截止竞赛',
        deadline: '2099-01-01',
        notes: '不应读取的大段材料'.repeat(1000),
      },
    });
    const archived = await db.project.create({
      data: {
        workspaceId: a.workspaceId,
        name: '已归档',
      },
    });
    await db.projectMember.create({
      data: { projectId: archived.id, userId: a.user.id, roles: ['PRODUCT'] },
    });
    await db.task.create({
      data: {
        workspaceId: a.workspaceId,
        projectId: archived.id,
        number: 1,
        data: seed.data,
      },
    });
    await db.project.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });
    const hidden = await db.project.create({
      data: { workspaceId: a.workspaceId, name: '未加入' },
    });
    await db.task.create({
      data: {
        workspaceId: a.workspaceId,
        projectId: hidden.id,
        number: 1,
        data: seed.data,
      },
    });
    const overview = '/workspaces/' + a.workspaceId + '/overview';
    const full = (await send(overview, 'GET', undefined, a)).data;
    const liteResponse = await send(overview + '-summary', 'GET', undefined, a),
      lite = liteResponse.data;
    assert.equal(liteResponse.status, 200);
    assert.match(liteResponse.headers.get('cache-control')!, /no-store/);
    assert.deepEqual(
      lite.todos.map((t: any) => t.id).sort(),
      full.todos.map((t: any) => t.id).sort(),
    );
    assert.deepEqual(lite.projects, full.projects);
    for (const summary of lite.todos) {
      const old = full.todos.find((t: any) => t.id === summary.id);
      assert.equal(summary.status, old.status);
      for (const key of ['title', 'dueAt', 'priority', 'workflow'])
        assert.deepEqual(summary.data[key] ?? null, old.data[key] ?? null);
      assert.deepEqual(
        summary.data.blocks.map((x: any) => x.reason),
        old.data.blocks.filter((x: any) => !x.end).map((x: any) => x.reason),
      );
      for (const key of [
        'comments',
        'history',
        'requirements',
        'reviews',
        'description',
      ])
        assert.equal(summary.data[key], undefined);
    }
    assert.deepEqual(
      lite.competitions.map((c: any) => ({
        id: c.id,
        name: c.name,
        deadline: c.deadline,
      })),
      full.competitions.map((c: any) => ({
        id: c.id,
        name: c.name,
        deadline: c.deadline,
      })),
    );
    assert.deepEqual(lite.documents, full.documents);
    assert.equal(
      (await send(overview + '-summary', 'GET', undefined, b)).data.projects
        .length,
      1,
    );
    const outsider = await register('外部');
    assert.equal(
      (await send(overview + '-summary', 'GET', undefined, outsider)).status,
      404,
    );
    const task = await db.task.findFirstOrThrow({
      where: { projectId: p.id, number: 100 },
    });
    const updates = '/tasks/' + task.id + '/discussion-updates';
    const original = (await send('/tasks/' + task.id, 'GET', undefined, a))
      .data;
    const omit = (
      await send(
        '/tasks/' + task.id + '?omitComments=true',
        'GET',
        undefined,
        a,
      )
    ).data;
    assert.deepEqual(omit, {
      ...original,
      data: { ...original.data, comments: [] },
    });
    const all = await send(updates, 'GET', undefined, a);
    assert.equal(all.status, 200);
    assert.deepEqual(all.data.comments, comments);
    let snapshot = mergeDiscussionUpdates(undefined, all.data);
    const empty = (
      await send(updates + '?after=' + comments.length, 'GET', undefined, a)
    ).data;
    assert.equal(empty.reset, false);
    assert.deepEqual(empty.comments, []);
    assert.equal(empty.total, comments.length);
    assert.equal(
      (await send(updates + '?after=-1', 'GET', undefined, a)).status,
      422,
    );
    assert.equal(
      (await send(updates + '?after=99999', 'GET', undefined, a)).data.reset,
      true,
    );
    const reply = await send(
      '/tasks/' + task.id + '/comments',
      'POST',
      {
        body: '真正的新增回复',
        replyTo: comments[0].id,
        expectedVersion: task.version,
      },
      a,
    );
    assert.equal(reply.status, 200);
    const delta = (
      await send(updates + '?after=' + comments.length, 'GET', undefined, a)
    ).data;
    assert.equal(delta.comments.length, 1);
    assert.equal(delta.from, comments.length);
    snapshot = mergeDiscussionUpdates(snapshot, delta);
    assert.deepEqual(
      snapshot.comments,
      (await send('/tasks/' + task.id + '/comments', 'GET', undefined, a)).data,
    );
    const rootVersion = snapshot.taskVersion;
    const resolved = await send(
      '/tasks/' + task.id + '/comments/' + comments[1].id,
      'PATCH',
      { resolved: true, reason: '增量状态结论', expectedVersion: rootVersion },
      a,
    );
    assert.equal(resolved.status, 200);
    snapshot = mergeDiscussionUpdates(
      snapshot,
      (await send(updates + '?after=' + snapshot.total, 'GET', undefined, a))
        .data,
    );
    assert.equal(
      discussionView(snapshot.comments).find((c) => c.id === comments[1].id)!
        .resolved,
      true,
    );
    const center = (
      await send(
        '/workspaces/' +
          a.workspaceId +
          '/discussions?scope=all&state=ALL&project=' +
          p.id +
          '&pageSize=100',
        'GET',
        undefined,
        a,
      )
    ).data;
    const expected = (
      await db.task.findMany({ where: { projectId: p.id, deletedAt: null } })
    ).flatMap((t) =>
      discussionView((t.data as any).comments)
        .filter((c) => c.kind === 'QUESTION' && !c.replyTo)
        .map((c) => ({ taskId: t.id, ...c })),
    );
    assert.equal(center.total, expected.length);
    for (const row of center.items) {
      const old = expected.find(
        (x) => x.taskId === row.taskId && x.id === row.id,
      )!;
      assert.equal(row.resolved, !!old.resolved);
      assert.equal(row.assigneeId, old.assigneeId ?? null);
      assert.equal(row.dueAt, old.dueAt ?? null);
      assert.equal(row.body, old.body.slice(0, 400));
    }
    const plan = await db.$queryRaw<any[]>(
      Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${questionEvents(a.user.id, a.workspaceId, p.id)} SELECT count(*) FROM questions`,
    );
    const scans: any[] = [];
    function visit(node: any) {
      if (node['Node Type'] === 'Function Scan') scans.push(node);
      for (const child of node.Plans || []) visit(child);
    }
    visit(plan[0]['QUERY PLAN'][0].Plan);
    assert.equal(scans.length, 1, '每条查询仅一个事件展开节点');
    assert(
      scans[0]['Actual Loops'] < expected.length,
      '按任务展开，不能每个问题再次扫描',
    );
    const measurement = {
      fullOverviewBytes: Buffer.byteLength(JSON.stringify(full)),
      summaryBytes: Buffer.byteLength(JSON.stringify(lite)),
      initialDiscussionBytes: Buffer.byteLength(JSON.stringify(all.data)),
      emptyDeltaBytes: Buffer.byteLength(JSON.stringify(empty)),
      oneReplyDeltaBytes: Buffer.byteLength(JSON.stringify(delta)),
      questions: expected.length,
      eventFunctionScanNodes: scans.length,
      eventFunctionScanLoops: scans[0]['Actual Loops'],
    };
    assert(measurement.summaryBytes < measurement.fullOverviewBytes / 5);
    assert(
      measurement.emptyDeltaBytes < measurement.initialDiscussionBytes / 10,
    );
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync(
      'artifacts/summary-updates-measurement.json',
      JSON.stringify(measurement, null, 2),
    );
    console.log('首页与讨论真实读取对照：', JSON.stringify(measurement));
    assert.equal((await send(updates, 'GET', undefined, outsider)).status, 404);
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: new Date() },
    });
    assert.equal((await send(updates, 'GET', undefined, a)).status, 200);
    assert.equal(
      (await send(overview + '-summary', 'GET', undefined, a)).data.todos
        .length,
      0,
    );
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: null },
    });
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: p.id, userId: b.user.id } },
    });
    assert.equal(
      (await send(updates + '?after=240', 'GET', undefined, b)).status,
      403,
    );
    assert.equal(
      (await send(overview + '-summary', 'GET', undefined, b)).data.projects
        .length,
      0,
    );
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: a.workspaceId, userId: a.user.id },
      },
    });
    assert.equal((await send(updates, 'GET', undefined, a)).status, 404);
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
