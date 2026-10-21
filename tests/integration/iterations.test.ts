import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
test('迭代与里程碑：真实验收统计、日期边界、计划权限、并发及回滚', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3108/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3108',
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
    const email = 'iterations-' + tag + '-' + randomUUID() + '@example.com',
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
    const a = await register('A'),
      b = await register('B'),
      c = await register('C');
    async function post(route: string, data: any, auth = a) {
      const r = await send(route, 'POST', data, auth);
      assert([200, 201, 204].includes(r.status), JSON.stringify(r));
      return r.data;
    }
    const p = await post('/workspaces/' + a.workspaceId + '/projects', {
      name: '迭代项目',
      workflow: 'SIMPLE',
    });
    await post('/projects/' + p.id + '/members', {
      userId: a.user.id,
      roles: ['PRODUCT', 'ENGINEER', 'QA'],
    });
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: b.user.id, role: 'MEMBER' },
    });
    await db.projectMember.create({
      data: { projectId: p.id, userId: b.user.id, roles: ['ENGINEER'] },
    });
    const root = '/projects/' + p.id + '/iterations',
      body = {
        name: '验收迭代',
        goal: '以真实验收衡量交付',
        ownerId: a.user.id,
        startDate: '2000-01-01',
        endDate: '2099-12-31',
      };
    assert.equal((await send(root, 'POST', body, b)).status, 403);
    assert.equal((await send(root, 'GET', undefined, c)).status, 404);
    assert.equal(
      (await send(root, 'POST', { ...body, ownerId: c.user.id }, a)).status,
      422,
    );
    const i = await post(root, body);
    const plan = root + '/' + i.id;
    const v = async () =>
      (await db.iteration.findUniqueOrThrow({ where: { id: i.id } })).version;
    await post(plan + '/milestones', {
      expectedVersion: await v(),
      name: '早期检查点',
      goal: '确认交付',
      dueDate: '2000-01-02',
    });
    let detail = (await send(plan, 'GET', undefined, a)).data;
    const m = detail.milestones[0];
    assert.equal(detail.progress.percent, 0);
    const old = await v();
    assert.equal(
      (
        await send(
          plan + '/milestones',
          'POST',
          { expectedVersion: old, name: '越界', dueDate: '2100-01-01' },
          a,
        )
      ).status,
      422,
    );
    assert.equal(await v(), old);
    const tasks: any[] = [];
    for (let n = 0; n < 14; n++)
      tasks.push(
        await post('/projects/' + p.id + '/tasks', {
          title: '迭代需求' + n,
          productId: a.user.id,
          engineerId: b.user.id,
          description: '说明',
          criteria: ['验收通过'],
        }),
      );
    const t = tasks[0],
      taskBefore = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    await post(plan + '/tasks', {
      expectedVersion: await v(),
      taskIds: tasks.slice(0, 13).map((t) => t.id),
      milestoneId: m.id,
    });
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).version,
      taskBefore.version,
    );
    assert.deepEqual(
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).data,
      taskBefore.data,
    );
    assert.equal(
      (await send('/tasks/' + t.id + '/iteration', 'GET', undefined, b)).data
        .iterationId,
      i.id,
    );
    const list = (
      await send(plan + '/tasks?page=2&pageSize=10', 'GET', undefined, a)
    ).data;
    assert.equal(list.total, 13);
    assert.equal(list.items.length, 3);
    assert(!JSON.stringify(list).includes('history'));
    const candidates = (
      await send(plan + '/candidates?pageSize=10&page=2', 'GET', undefined, b)
    ).data;
    assert.equal(candidates.total, 14);
    assert.equal(candidates.items.length, 4);
    const exact = (
      await send(plan + '/candidates?q=CF-' + t.number, 'GET', undefined, b)
    ).data;
    assert.equal(exact.items.length, 1);
    assert.equal(exact.items[0].id, t.id);
    assert.equal(exact.items[0].iterationId, i.id);
    const setStatus = async (t: any, status: string, extra = {}) => {
      const current = await db.task.findUniqueOrThrow({ where: { id: t.id } });
      await db.task.update({ where: { id: t.id }, data: { status, ...extra } });
      return current;
    };
    await setStatus(tasks[0], 'CLOSED');
    await setStatus(tasks[1], 'CANCELLED');
    await setStatus(tasks[2], 'DRAFT', { deletedAt: new Date() });
    const blocked = await db.task.findUniqueOrThrow({
      where: { id: tasks[3].id },
    });
    await db.task.update({
      where: { id: tasks[3].id },
      data: {
        data: {
          ...(blocked.data as any),
          blocks: [
            { start: new Date().toISOString(), reason: '外部接口尚未提供' },
          ],
        },
      },
    });
    detail = (await send(plan, 'GET', undefined, b)).data;
    assert.equal(detail.progress.planned, 11);
    assert.equal(detail.progress.accepted, 1);
    assert.equal(detail.progress.percent, 9);
    assert.equal(detail.progress.cancelled, 1);
    assert.equal(detail.progress.deleted, 1);
    assert.equal(detail.progress.overdue, 10);
    assert.equal(detail.progress.blocked, 1);
    assert.equal(detail.canManage, false);
    assert.equal(
      (await send(plan + '/tasks?filter=overdue', 'GET', undefined, b)).data
        .total,
      10,
    );
    const late = (
      await send(plan + '/tasks?q=CF-' + tasks[3].number, 'GET', undefined, b)
    ).data.items[0];
    assert.deepEqual(late.blockReasons, ['外部接口尚未提供']);
    assert.equal(late.handlerIds[0], a.user.id);
    assert.equal(
      (
        await send(
          plan + '/tasks/' + tasks[3].id,
          'PATCH',
          {
            expectedVersion: await v(),
            milestoneId: m.id,
            delayNote: '等待接口，周五复查',
          },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          plan + '/tasks/' + tasks[3].id,
          'PATCH',
          {
            expectedVersion: await v(),
            milestoneId: m.id,
            delayNote: '等待接口，周五复查',
          },
          a,
        )
      ).status,
      204,
    );
    const source = await post(root, { ...body, name: '另一个迭代' });
    assert.equal(
      (
        await send(
          root + '/' + source.id + '/tasks',
          'POST',
          { expectedVersion: 1, taskIds: [t.id] },
          a,
        )
      ).status,
      409,
    );
    const foreignProject = await post(
      '/workspaces/' + a.workspaceId + '/projects',
      { name: '隔离项目', workflow: 'SIMPLE' },
    );
    const foreignTask = await post(
      '/projects/' + foreignProject.id + '/tasks',
      { title: '其他项目需求', productId: a.user.id },
    );
    await assert.rejects(
      db.iterationTask.create({
        data: {
          iterationId: i.id,
          taskId: foreignTask.id,
          createdBy: a.user.id,
        },
      }),
    );
    const otherMilestone = await post(root + '/' + source.id + '/milestones', {
      expectedVersion: 1,
      name: '其他迭代检查点',
      dueDate: '2000-01-02',
    });
    const sourceMs = await db.iterationMilestone.findFirstOrThrow({
      where: { iterationId: source.id },
    });
    await assert.rejects(
      db.iterationTask.update({
        where: { taskId: t.id },
        data: { milestoneId: sourceMs.id },
      }),
    );
    assert.equal(
      (
        await send(
          plan + '/tasks/' + tasks[3].id,
          'PATCH',
          {
            expectedVersion: await v(),
            milestoneId: sourceMs.id,
            delayNote: '跨迭代安排',
          },
          a,
        )
      ).status,
      422,
    );
    const before = await v();
    assert.equal(
      (
        await send(
          plan + '/tasks',
          'POST',
          { expectedVersion: before, taskIds: [tasks[13].id, foreignTask.id] },
          a,
        )
      ).status,
      422,
    );
    assert.equal(await v(), before);
    assert.equal(
      await db.iterationTask.count({ where: { taskId: tasks[13].id } }),
      0,
    );
    assert.equal(
      (
        await send(
          '/tasks/' + t.id,
          'PATCH',
          {
            expectedVersion: taskBefore.version,
            projectId: foreignProject.id,
            engineerId: a.user.id,
          },
          a,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          plan,
          'PATCH',
          { ...body, expectedVersion: await v(), endDate: '2100-01-01' },
          a,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await send(
          plan,
          'PATCH',
          {
            ...body,
            expectedVersion: await v(),
            startDate: '2000-01-03',
            changeReason: '时间缩短',
          },
          a,
        )
      ).status,
      422,
    );
    const version = await v();
    const updates = await Promise.all(
      ['并发A', '并发B'].map((name) =>
        send(plan, 'PATCH', { ...body, name, expectedVersion: version }, a),
      ),
    );
    assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await v(), version + 1);
    assert.equal(
      (
        await send(
          plan,
          'PATCH',
          { ...body, ownerId: b.user.id, expectedVersion: await v() },
          a,
        )
      ).status,
      200,
    );
    assert.equal((await send(plan, 'GET', undefined, b)).data.canManage, true);
    assert.equal(
      (
        await send(
          plan + '/milestones/' + m.id,
          'DELETE',
          { expectedVersion: await v() },
          a,
        )
      ).status,
      409,
    );
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const daily = await post(root, {
      ...body,
      name: '当日边界',
      startDate: today,
      endDate: today,
    });
    await post(root + '/' + daily.id + '/tasks', {
      expectedVersion: 1,
      taskIds: [tasks[13].id],
    });
    assert.equal(
      (await send(root + '/' + daily.id, 'GET', undefined, a)).data.progress
        .overdue,
      0,
    );
    const audit = 'reject_iteration_audit_' + Date.now();
    await db.$executeRawUnsafe(
      'CREATE FUNCTION ' +
        audit +
        "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ITERATION_REMOVE_TASK' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER ' +
        audit +
        ' BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ' +
        audit +
        '()',
    );
    const prior = await v();
    try {
      assert.equal(
        (
          await send(
            plan + '/tasks/' + t.id,
            'DELETE',
            { expectedVersion: prior },
            a,
          )
        ).status,
        500,
      );
      assert.equal(await v(), prior);
      assert.equal(
        await db.iterationTask.count({ where: { taskId: t.id } }),
        1,
      );
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER ' + audit + ' ON "AuditEvent"');
      await db.$executeRawUnsafe('DROP FUNCTION ' + audit + '()');
    }
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: new Date() },
    });
    assert.equal((await send(plan, 'GET', undefined, a)).data.readOnly, true);
    assert.equal(
      (
        await send(
          plan + '/tasks/' + t.id,
          'DELETE',
          { expectedVersion: await v() },
          a,
        )
      ).status,
      409,
    );
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: null },
    });
    assert.equal(
      (
        await send(
          plan + '/tasks/' + t.id,
          'DELETE',
          { expectedVersion: await v() },
          a,
        )
      ).status,
      204,
    );
    assert.equal(
      (await send('/tasks/' + t.id + '/iteration', 'GET', undefined, a)).data,
      null,
    );
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).status,
      'CLOSED',
    );
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: p.id, userId: b.user.id } },
    });
    assert.equal((await send(plan, 'GET', undefined, b)).status, 403);
    assert.equal(
      (await send(root + '/' + source.id, 'GET', undefined, c)).status,
      404,
    );
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
