import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

test('行动聚焦：先筛选后分页、截止日独立维护、历史基线及全项目简报', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3115/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3115',
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
      password = 'Focus-test-2026!';
    const reg = await send('/auth/register', 'POST', {
      kind: 'creator',
      name,
      email,
      password,
      teamName: name,
    });
    assert.equal(reg.status, 201);
    const login = await send('/auth/login', 'POST', { email, password });
    return {
      ...login.data,
      workspaceId: reg.data.workspaceId,
      cookie: login.headers.get('set-cookie')!.split(';')[0],
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
    const admin = await register('聚焦负责人'),
      member = await register('聚焦执行人'),
      observer = await register('只读协作者');
    async function post(path: string, data: any, user = admin) {
      const r = await send(path, 'POST', data, user);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data;
    }
    const p = await post('/workspaces/' + admin.workspaceId + '/projects', {
      name: '行动聚焦验证',
      workflow: 'SIMPLE',
    });
    const root = '/projects/' + p.id;
    for (const u of [member, observer]) {
      await db.workspaceMember.create({
        data: {
          workspaceId: admin.workspaceId,
          userId: u.user.id,
          role: 'MEMBER',
        },
      });
      await db.projectMember.create({
        data: { projectId: p.id, userId: u.user.id, roles: ['ENGINEER'] },
      });
    }
    const task = await post(root + '/tasks', {
      title: '行动原文资料',
      description: '聚焦验证',
      criteria: ['真实结果'],
      productId: admin.user.id,
      engineerId: member.user.id,
      testerId: admin.user.id,
      productReviewerId: admin.user.id,
      qaReviewerId: admin.user.id,
    });
    const actions: any[] = [];
    for (let i = 0; i < 23; i++)
      actions.push(
        await post(root + '/actions', {
          taskId: task.id,
          expectedTaskVersion: task.version,
          title: i === 0 ? '核对100%交付说明' : '行动条目' + i,
          acceptance: '能够逐项复核',
          evidence: '行动原文资料',
        }),
      );
    const read = async (query = '') =>
      (await send(root + '/progress' + query, 'GET', undefined, admin)).data;
    const baselineState = await read();
    const first = await post(root + '/checkpoints', {
      fingerprint: baselineState.fingerprint,
      latestId: null,
      note: '初始历史基线',
      requestKey: randomUUID(),
    });
    let a = actions[0];
    const change = async (operation: string, user: any, extra: any = {}) => {
      a = await post(
        root + '/actions/' + a.id + '/change',
        {
          expectedVersion: a.version,
          expectedTaskVersion: task.version,
          operation,
          note: '聚焦验证' + operation,
          requestKey: randomUUID(),
          ...extra,
        },
        user,
      );
      return a;
    };
    await change('ASSIGN', admin, {
      ownerId: member.user.id,
      dueDate: '2000-01-01',
    });
    const overdue = await read('?scope=OVERDUE');
    assert.equal(overdue.total, 1);
    assert.equal((await read('?page=2')).actions.length, 3);
    assert.equal((await read('?scope=MINE')).total, 0);
    const memberMine = await send(
      root + '/progress?scope=MINE',
      'GET',
      undefined,
      member,
    );
    assert.equal(memberMine.data.total, 1);
    assert.equal((await read('?q=%25')).total, 1);
    assert.equal((await read('?q=' + encodeURIComponent('.*'))).total, 0);
    assert.equal(
      (await read('?q=' + encodeURIComponent('聚焦执行人'))).total,
      1,
    );
    assert.equal((await read('?q=CF-' + task.number)).total, 23);
    await change('SUBMIT', member, { note: '保留这份已提交成果' });
    assert.equal((await read('?scope=REVIEW')).total, 1);
    const payload = {
      expectedVersion: a.version,
      expectedTaskVersion: task.version,
      operation: 'RESCHEDULE',
      note: '等待团队核对，调整确认日期',
      dueDate: '2099-01-01',
      requestKey: randomUUID(),
    };
    const denied = await send(
      root + '/actions/' + a.id + '/change',
      'POST',
      payload,
      observer,
    );
    assert.equal(denied.status, 403);
    const before = {
      status: a.status,
      ownerId: a.ownerId,
      outcome: a.outcome,
      version: a.version,
    };
    a = await post(root + '/actions/' + a.id + '/change', payload, member);
    assert.equal(a.status, before.status);
    assert.equal(a.ownerId, before.ownerId);
    assert.equal(a.outcome, before.outcome);
    assert.equal(a.events.at(-1).previousDueDate, '2000-01-01');
    assert.equal(
      (await post(root + '/actions/' + a.id + '/change', payload, member))
        .version,
      a.version,
    );
    assert.equal(
      (
        await send(
          root + '/actions/' + a.id + '/change',
          'POST',
          { ...payload, requestKey: randomUUID() },
          member,
        )
      ).status,
      409,
    );
    assert.equal((await read('?scope=OVERDUE')).total, 0);
    assert.equal(
      (await send(root + '/actions/' + a.id, 'GET', undefined, member)).data
        .version,
      a.version,
    );
    await change('RESCHEDULE', member, {
      dueDate: null,
      note: '日期待确认，明确清空截止日',
    });
    assert.equal(a.dueDate, null);
    assert.equal(a.status, 'SUBMITTED');
    assert.equal(a.outcome, before.outcome);
    const unchangedDate = await send(
      root + '/actions/' + a.id + '/change',
      'POST',
      {
        expectedVersion: a.version,
        expectedTaskVersion: task.version,
        operation: 'RESCHEDULE',
        dueDate: null,
        note: '重复空日期',
        requestKey: randomUUID(),
      },
      member,
    );
    assert.equal(unchangedDate.status, 422);
    assert(
      (await db.notification.count({
        where: {
          recipientId: admin.user.id,
          taskId: task.id,
          message: { contains: '截止日调整为' },
        },
      })) > 0,
    );
    await change('ACCEPT', admin);
    assert.equal(
      (
        await send(
          root + '/actions/' + a.id + '/change',
          'POST',
          {
            ...payload,
            expectedVersion: a.version,
            dueDate: null,
            requestKey: randomUUID(),
          },
          admin,
        )
      ).status,
      409,
    );
    const current = await read();
    const second = await post(root + '/checkpoints', {
      fingerprint: current.fingerprint,
      latestId: first.id,
      note: '完成确认后的基线',
      requestKey: randomUUID(),
    });
    const latest = await read();
    assert.deepEqual(latest.comparison.changes, []);
    const historic = await read('?checkpointId=' + first.id);
    assert.equal(historic.baseline.id, first.id);
    assert.equal(historic.latest.id, second.id);
    assert(
      historic.comparison.changes.some((c: any) => c.change.endsWith('DONE')),
    );
    let last = second.id;
    for (let i = 0; i < 20; i++) {
      const c = await post(root + '/checkpoints', {
        fingerprint: current.fingerprint,
        latestId: last,
        note: '保留历史' + i,
        requestKey: randomUUID(),
      });
      last = c.id;
    }
    const page2 = await send(
      root + '/checkpoints?page=2',
      'GET',
      undefined,
      member,
    );
    assert.equal(page2.data.total, 22);
    assert.equal(page2.data.items.length, 2);
    assert(page2.data.items.some((c: any) => c.id === first.id));
    const foreign = await post(
      '/workspaces/' + observer.workspaceId + '/projects',
      { name: '其他项目', workflow: 'SIMPLE' },
      observer,
    );
    const foreignRoot = '/projects/' + foreign.id;
    const foreignState = (
      await send(foreignRoot + '/progress', 'GET', undefined, observer)
    ).data;
    const foreignCp = await post(
      foreignRoot + '/checkpoints',
      {
        fingerprint: foreignState.fingerprint,
        latestId: null,
        note: '其他项目记录',
        requestKey: randomUUID(),
      },
      observer,
    );
    assert.equal(
      (
        await send(
          root + '/progress?checkpointId=' + foreignCp.id,
          'GET',
          undefined,
          admin,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await send(
          root + '/progress-brief?checkpointId=' + foreignCp.id,
          'GET',
          undefined,
          admin,
        )
      ).status,
      404,
    );
    const brief = await send(
      root + '/progress-brief?checkpointId=' + first.id + '&scope=MINE&page=2',
      'GET',
      undefined,
      member,
    );
    assert.equal(brief.status, 200);
    assert(brief.data.content.includes('初始历史基线'));
    assert(brief.data.content.includes('全项目行动（23项'));
    assert(brief.data.content.includes('行动条目22'));
    assert(brief.data.content.includes('保留这份已提交成果'));
    assert.equal((await send(root + '/progress-brief')).status, 401);
    assert.equal(
      (await send(foreignRoot + '/actions/' + a.id, 'GET', undefined, observer))
        .status,
      404,
    );
    await send(root, 'PATCH', { archived: true }, admin);
    assert.equal(
      (await send(root + '/progress-brief', 'GET', undefined, member)).status,
      200,
    );
    assert.equal(
      (
        await send(
          root + '/actions/' + a.id + '/change',
          'POST',
          { ...payload, expectedVersion: a.version, requestKey: randomUUID() },
          member,
        )
      ).status,
      409,
    );
  } finally {
    child.kill();
    await db.$disconnect();
  }
});
