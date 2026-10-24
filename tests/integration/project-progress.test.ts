import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

test('行动与检查点：真实认领交付、独立确认、隔离、并发、历史及审计回滚', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3114/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3114',
        APP_ORIGIN: origin,
        COFLOW_IMPORT_ONLY: '',
        STORAGE_DIR: './storage-test',
      },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stderr.on('data', (b) => (output += b.toString()));
  async function send(path: string, method = 'GET', data?: any, user?: any) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(user ? { Cookie: user.cookie, 'X-CSRF-Token': user.csrf } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  }
  async function register(name: string) {
    const email = randomUUID() + '@example.com',
      password = 'Progress-test-2026!';
    const registered = await send('/auth/register', 'POST', {
      kind: 'creator',
      name,
      email,
      password,
      teamName: name,
    });
    assert.equal(registered.status, 201);
    const login = await send('/auth/login', 'POST', { email, password });
    return {
      ...login.data,
      workspaceId: registered.data.workspaceId,
      cookie: login.headers.get('set-cookie')!.split(';')[0],
    };
  }
  let trigger = false;
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + '/health')).ok) break;
      } catch {}
      assert(i < 100, output);
      await new Promise((r) => setTimeout(r, 100));
    }
    const admin = await register('行动负责人'),
      member = await register('行动执行人'),
      outsider = await register('外部成员');
    async function post(path: string, data: any, user = admin) {
      const r = await send(path, 'POST', data, user);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data;
    }
    const p = await post('/workspaces/' + admin.workspaceId + '/projects', {
      name: '专业交付验证',
      workflow: 'SIMPLE',
    });
    await db.workspaceMember.create({
      data: {
        workspaceId: admin.workspaceId,
        userId: member.user.id,
        role: 'MEMBER',
      },
    });
    await db.projectMember.create({
      data: { projectId: p.id, userId: member.user.id, roles: ['ENGINEER'] },
    });
    const task = await post('/projects/' + p.id + '/tasks', {
      title: '补齐交付说明',
      description: '需要团队核对',
      criteria: [],
      productId: admin.user.id,
      engineerId: member.user.id,
      testerId: admin.user.id,
      productReviewerId: admin.user.id,
      qaReviewerId: admin.user.id,
    });
    const root = '/projects/' + p.id;
    const input = {
      taskId: task.id,
      expectedTaskVersion: task.version,
      title: '整理交付说明',
      acceptance: '提供可复核步骤',
      evidence: '补齐交付说明',
    };
    assert.equal((await send(root + '/progress')).status, 401);
    assert.equal(
      (await send(root + '/progress', 'GET', undefined, outsider)).status,
      404,
    );
    assert.equal(
      (await send(root + '/actions', 'POST', input, outsider)).status,
      404,
    );
    assert.equal(
      (
        await send(
          root + '/actions',
          'POST',
          { ...input, evidence: '虚构证据' },
          admin,
        )
      ).status,
      422,
    );
    let a = await post(root + '/actions', input);
    assert.equal((await post(root + '/actions', input)).id, a.id);
    const progress = async () =>
      (await send(root + '/progress', 'GET', undefined, admin)).data;
    let overview = await progress();
    assert(
      !overview.readiness[0].checks.find((c: any) => c.key === 'criteria').ok,
    );
    assert(
      !overview.readiness[0].checks.find((c: any) => c.key === 'materials').ok,
    );
    const cpInput = {
      fingerprint: overview.fingerprint,
      latestId: null,
      note: '首次推进基线',
      requestKey: randomUUID(),
    };
    const checkpoint = await post(root + '/checkpoints', cpInput);
    assert.equal(
      (await post(root + '/checkpoints', cpInput)).id,
      checkpoint.id,
    );
    assert.equal(
      (
        await send(
          root + '/checkpoints',
          'POST',
          { ...cpInput, requestKey: randomUUID() },
          admin,
        )
      ).status,
      409,
    );
    const claim = {
      expectedVersion: a.version,
      expectedTaskVersion: task.version,
      operation: 'CLAIM',
      note: '我来执行',
      dueDate: '2026-10-22',
      requestKey: randomUUID(),
    };
    const claims = await Promise.all([
      send(root + '/actions/' + a.id + '/change', 'POST', claim, member),
      send(
        root + '/actions/' + a.id + '/change',
        'POST',
        { ...claim, requestKey: randomUUID() },
        admin,
      ),
    ]);
    assert.deepEqual(claims.map((c) => c.status).sort(), [200, 409]);
    a = claims.find((c) => c.status === 200)!.data;
    if (a.ownerId !== member.user.id)
      a = await post(root + '/actions/' + a.id + '/change', {
        expectedVersion: a.version,
        expectedTaskVersion: task.version,
        operation: 'ASSIGN',
        ownerId: member.user.id,
        note: '交给执行人',
        requestKey: randomUUID(),
      });
    const change = async (operation: string, user = admin, extra: any = {}) => {
      a = await post(
        root + '/actions/' + a.id + '/change',
        {
          expectedVersion: a.version,
          expectedTaskVersion: task.version,
          operation,
          note: '验证' + operation,
          requestKey: randomUUID(),
          ...extra,
        },
        user,
      );
      return a;
    };
    await change('ASSIGN', admin, { ownerId: admin.user.id });
    await change('SUBMIT', admin, { note: '负责人自行提交成果' });
    const selfConfirmation = await send(
      root + '/actions/' + a.id + '/change',
      'POST',
      {
        expectedVersion: a.version,
        expectedTaskVersion: task.version,
        operation: 'ACCEPT',
        note: '不能自行确认',
        requestKey: randomUUID(),
      },
      admin,
    );
    assert.equal(selfConfirmation.status, 403);
    await change('ASSIGN', admin, { ownerId: member.user.id });
    assert.equal(a.outcome, '');
    assert.equal(
      (
        await send(
          root + '/actions/' + a.id + '/change',
          'POST',
          {
            expectedVersion: a.version,
            expectedTaskVersion: task.version,
            operation: 'ACCEPT',
            note: '越权',
            requestKey: randomUUID(),
          },
          member,
        )
      ).status,
      403,
    );
    await change('SUBMIT', member, {
      note: '实际成果：交付说明已整理，可按步骤核对',
    });
    await change('RETURN', admin, { note: '补充失败场景' });
    const submission = {
      expectedVersion: a.version,
      expectedTaskVersion: task.version,
      operation: 'SUBMIT',
      note: '已补充失败场景及预期结果',
      requestKey: randomUUID(),
    };
    a = await post(root + '/actions/' + a.id + '/change', submission, member);
    assert.equal(
      (await post(root + '/actions/' + a.id + '/change', submission, member))
        .version,
      a.version,
    );
    await change('ACCEPT');
    assert.equal(a.status, 'DONE');
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status,
      'DRAFT',
    );
    overview = await progress();
    assert(
      overview.comparison.changes.some(
        (c: any) => c.kind === 'actions' && c.change.endsWith('DONE'),
      ),
    );
    await assert.rejects(
      db.projectCheckpoint.update({
        where: { id: checkpoint.id },
        data: { note: '篡改' },
      }),
    );
    await assert.rejects(
      db.projectAction.update({ where: { id: a.id }, data: { events: [] } }),
    );
    await assert.rejects(db.projectAction.delete({ where: { id: a.id } }));
    const beforeVersion = a.version;
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_progress_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."resourceId"='${a.id}' AND NEW.action='PROJECT_ACTION_REOPEN' THEN RAISE EXCEPTION 'test audit rollback'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_progress_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_progress_audit()',
    );
    trigger = true;
    assert.equal(
      (
        await send(
          root + '/actions/' + a.id + '/change',
          'POST',
          {
            expectedVersion: a.version,
            expectedTaskVersion: task.version,
            operation: 'REOPEN',
            note: '触发回滚',
            requestKey: randomUUID(),
          },
          admin,
        )
      ).status,
      500,
    );
    assert.equal(
      (await db.projectAction.findUniqueOrThrow({ where: { id: a.id } }))
        .version,
      beforeVersion,
    );
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_progress_audit ON "AuditEvent"',
    );
    await db.$executeRawUnsafe('DROP FUNCTION fail_progress_audit()');
    trigger = false;
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: p.id, userId: member.user.id } },
    });
    await change('REOPEN');
    assert.equal(a.status, 'OPEN');
    assert.equal(a.ownerId, null);
    await db.projectMember.create({
      data: { projectId: p.id, userId: member.user.id, roles: ['ENGINEER'] },
    });
    await change('CLAIM', member);
    await db.task.update({
      where: { id: task.id },
      data: { version: { increment: 1 } },
    });
    assert.equal(
      (
        await send(
          root + '/actions/' + a.id + '/change',
          'POST',
          {
            expectedVersion: a.version,
            expectedTaskVersion: task.version,
            operation: 'SUBMIT',
            note: '旧需求版本',
            requestKey: randomUUID(),
          },
          member,
        )
      ).status,
      409,
    );
    const updated = await progress();
    assert(updated.actions[0].sourceChanged);
    assert(
      updated.comparison.changes.some(
        (c: any) => c.change === '资料更新，阶段未变化',
      ),
    );
    const staleCp = await send(
      root + '/checkpoints',
      'POST',
      { ...cpInput, latestId: checkpoint.id, requestKey: randomUUID() },
      admin,
    );
    assert.equal(staleCp.status, 409);
    await send(root, 'PATCH', { archived: true }, admin);
    assert.equal(
      (await send(root + '/actions', 'POST', input, admin)).status,
      409,
    );
    assert.equal(
      (await send(root + '/progress', 'GET', undefined, admin)).status,
      200,
    );
    assert((await db.notification.count({ where: { taskId: task.id } })) > 0);
  } finally {
    if (trigger) {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS fail_progress_audit ON "AuditEvent"',
      );
      await db.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS fail_progress_audit()',
      );
    }
    child.kill();
    await db.$disconnect();
  }
});
