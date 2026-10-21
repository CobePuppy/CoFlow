import 'dotenv/config';
import { discussionView } from '../../packages/contracts/src/discussion.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
test('澄清跟进：指派、转交、汇总、通知定位、并发与回滚', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3111/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3111',
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
    const email = 'refs-' + tag + '-' + randomUUID() + '@example.com',
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
    const p = (
      await send(
        '/workspaces/' + a.workspaceId + '/projects',
        'POST',
        { name: '引用项目', workflow: 'SIMPLE' },
        a,
      )
    ).data;
    await send(
      '/projects/' + p.id + '/members',
      'POST',
      { userId: a.user.id, roles: ['PRODUCT', 'ENGINEER'] },
      a,
    );
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: b.user.id, role: 'MEMBER' },
    });
    await db.projectMember.create({
      data: { projectId: p.id, userId: b.user.id, roles: ['ENGINEER'] },
    });
    const t = (
      await send(
        '/projects/' + p.id + '/tasks',
        'POST',
        { title: '引用需求', productId: a.user.id, engineerId: b.user.id },
        a,
      )
    ).data;

    const root = '/tasks/' + t.id + '/comments',
      center = '/workspaces/' + a.workspaceId + '/discussions';
    const version = async () =>
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).version;
    const post = async (input: any, who = a) =>
      send(
        root,
        'POST',
        {
          expectedVersion: await version(),
          kind: 'QUESTION',
          body: '确认验收范围',
          ...input,
        },
        who,
      );
    assert.equal((await post({ assigneeId: c.user.id })).status, 422);
    const q = await post({ assigneeId: b.user.id, dueAt: '2000-01-01' });
    assert.equal(q.status, 200, JSON.stringify(q.data));
    let list = await send(center, 'GET', undefined, b);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.equal(list.data.total, 1);
    assert.equal(list.data.items[0].overdue, true);
    assert.equal(list.data.items[0].assigneeId, b.user.id);
    assert.equal(
      (await send(center + '?scope=created', 'GET', undefined, a)).data.total,
      1,
    );
    assert.equal((await send(center, 'GET', undefined, c)).status, 404);
    const notices = (
      await send(
        '/notifications?workspace=' + a.workspaceId,
        'GET',
        undefined,
        b,
      )
    ).data.items;
    assert.equal(notices[0].discussionId, q.data.id);
    const assign = root + '/' + q.data.id + '/assignment';
    const before = await version();
    const payload = {
      expectedVersion: before,
      assigneeId: a.user.id,
      dueAt: '2099-01-01',
      reason: '交给产品核对',
    };
    assert.equal((await send(assign, 'PATCH', payload, b)).status, 200);
    assert.equal((await send(assign, 'PATCH', payload, a)).status, 409);
    assert.equal((await send(center, 'GET', undefined, b)).data.total, 0);
    assert.equal((await send(center, 'GET', undefined, a)).data.total, 1);
    assert.equal(
      (
        await send(
          root + '/' + q.data.id,
          'PATCH',
          {
            expectedVersion: await version(),
            resolved: true,
            reason: '范围已明确',
          },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          root + '/' + q.data.id,
          'PATCH',
          {
            expectedVersion: await version(),
            resolved: true,
            reason: '范围已明确',
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send(center + '?state=RESOLVED', 'GET', undefined, a)).data.total,
      1,
    );
    await db.task.update({
      where: { id: t.id },
      data: {
        data: {
          ...((await db.task.findUniqueOrThrow({ where: { id: t.id } }))
            .data as any),
          requirementVersion: 99,
        },
        version: { increment: 1 },
      },
    });
    assert.equal(
      (await send(center + '?state=RESOLVED', 'GET', undefined, a)).data
        .items[0].needsReview,
      true,
    );
    for (let i = 0; i < 23; i++)
      assert.equal(
        (await post({ body: '分页问题' + i, assigneeId: a.user.id })).status,
        200,
      );
    list = await send(center + '?page=2&pageSize=20', 'GET', undefined, a);
    assert.equal(list.data.total, 23);
    assert.equal(list.data.items.length, 3);
    assert.equal(
      (await send(center + '?q=分页问题22', 'GET', undefined, a)).data.total,
      1,
    );
    assert.equal(
      (await send(center + '?q=CF-' + t.number, 'GET', undefined, a)).data
        .total,
      23,
    );
    const audit = 'reject_question_' + Date.now();
    await db.$executeRawUnsafe(
      'CREATE FUNCTION ' +
        audit +
        "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DISCUSSION_ASSIGN' THEN RAISE EXCEPTION 'rollback'; END IF; RETURN NEW; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER ' +
        audit +
        ' BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ' +
        audit +
        '()',
    );
    const v = await version(),
      n = await db.notification.count({ where: { taskId: t.id } });
    try {
      assert.equal(
        (await send(assign, 'PATCH', { ...payload, expectedVersion: v }, a))
          .status,
        500,
      );
      assert.equal(await version(), v);
      assert.equal(await db.notification.count({ where: { taskId: t.id } }), n);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER ' + audit + ' ON "AuditEvent"');
      await db.$executeRawUnsafe('DROP FUNCTION ' + audit + '()');
    }
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: new Date() },
    });
    assert.equal(
      (await send(center + '?scope=all', 'GET', undefined, a)).data.total,
      0,
    );
    assert.equal(
      (
        await send(
          assign,
          'PATCH',
          { ...payload, expectedVersion: await version() },
          a,
        )
      ).status,
      409,
    );
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: null },
    });
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: p.id, userId: b.user.id } },
    });
    assert.equal(
      (await send(center + '?scope=all', 'GET', undefined, b)).data.total,
      0,
    );
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
