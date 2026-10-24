import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

test('目标工作台：关联去重、权限、版本历史、AI过期保护与批量原子交付', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3116/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3116',
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

    const fields = {
      title: '交付目标',
      description: '目标说明',
      criteria: ['可验证成果'],
      ownerId: admin.user.id,
      dueDate: '2026-10-22',
    };
    const create = { ...fields, requestKey: randomUUID() };
    assert.equal(
      (await send(root + '/goals', 'POST', create, member)).status,
      403,
    );
    let g = await post(root + '/goals', create);
    assert.equal((await post(root + '/goals', create)).id, g.id);
    const snap = async () =>
      (await send(root + '/assistant', 'GET', undefined, admin)).data;
    const old = await snap();
    const iteration = await db.iteration.create({
      data: {
        projectId: p.id,
        workspaceId: p.workspaceId,
        name: '目标迭代',
        goal: '里程碑交付',
        ownerId: admin.user.id,
        startDate: '2026-10-20',
        endDate: '2026-10-30',
        createdBy: admin.user.id,
      },
    });
    const milestone = await db.iterationMilestone.create({
      data: {
        iterationId: iteration.id,
        name: '可验收里程碑',
        dueDate: '2026-10-25',
      },
    });
    await db.iterationTask.create({
      data: {
        iterationId: iteration.id,
        taskId: task.id,
        milestoneId: milestone.id,
        createdBy: admin.user.id,
      },
    });
    const change = async (operation: string, extra: any = {}, user = admin) =>
      post(
        root + '/goals/' + g.id + '/change',
        {
          operation,
          expectedVersion: g.version,
          note: '真实变更原因',
          requestKey: randomUUID(),
          ...extra,
        },
        user,
      );
    g = await change('LINK', {
      taskIds: [task.id],
      iterationIds: [iteration.id],
    });
    const view = (
      await send(root + '/goals?goalId=' + g.id, 'GET', undefined, admin)
    ).data;
    assert.deepEqual(view.goals[0].taskIds, [task.id]);
    assert.equal(view.goals[0].progress.planned, 1);
    assert.deepEqual(view.iterations[0].milestones[0].taskIds, [task.id]);
    assert.notEqual((await snap()).fingerprint, old.fingerprint);
    const endpoint = root + '/goals/' + g.id + '/change';
    assert.equal(
      (
        await send(
          endpoint,
          'POST',
          {
            operation: 'EDIT',
            fields,
            expectedVersion: 1,
            note: '过期',
            requestKey: randomUUID(),
          },
          admin,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          endpoint,
          'POST',
          {
            operation: 'LINK',
            taskIds: [randomUUID()],
            iterationIds: [],
            expectedVersion: g.version,
            note: '跨项目',
            requestKey: randomUUID(),
          },
          admin,
        )
      ).status,
      422,
    );
    assert.equal(
      await db.projectGoalTask.count({ where: { goalId: g.id } }),
      1,
    );
    g = await change('STATUS', { status: 'ARCHIVED' });
    assert.equal(
      (
        await send(
          endpoint,
          'POST',
          {
            operation: 'LINK',
            taskIds: [],
            iterationIds: [],
            expectedVersion: g.version,
            note: '归档限制',
            requestKey: randomUUID(),
          },
          admin,
        )
      ).status,
      409,
    );
    g = await change('EDIT', {
      fields: { ...fields, ownerId: member.user.id },
    });
    g = await change('STATUS', { status: 'ACTIVE' }, member);
    const history = (
      await send(root + '/goals/' + g.id, 'GET', undefined, admin)
    ).data;
    assert.equal(history.events.length, 5);
    await assert.rejects(
      db.projectGoal.update({
        where: { id: g.id },
        data: { events: [], version: { increment: 1 } },
      }),
    );
    const action = {
      taskId: task.id,
      expectedTaskVersion: task.version,
      title: '批量行动',
      acceptance: '逐项核对',
      evidence: '行动原文资料',
    };
    const stale = await send(
      root + '/actions/adopt',
      'POST',
      {
        planFingerprint: old.fingerprint,
        requestKey: randomUUID(),
        actions: [action],
      },
      admin,
    );
    assert.equal(stale.status, 409);
    const fresh = await snap();
    const bad = {
      planFingerprint: fresh.fingerprint,
      requestKey: randomUUID(),
      actions: [action, { ...action, taskId: randomUUID() }],
    };
    assert.equal(
      (await send(root + '/actions/adopt', 'POST', bad, admin)).status,
      409,
    );
    assert.equal(
      await db.projectAction.count({ where: { projectId: p.id } }),
      0,
    );
    const batch = {
      planFingerprint: fresh.fingerprint,
      requestKey: randomUUID(),
      actions: [action],
    };
    const receipt = await post(root + '/actions/adopt', batch);
    assert.equal(receipt.items.length, 1);
    assert.deepEqual(await post(root + '/actions/adopt', batch), receipt);
    assert.notEqual((await snap()).fingerprint, fresh.fingerprint);
    assert.equal(
      (
        await send(
          root + '/goals?goalId=' + randomUUID(),
          'GET',
          undefined,
          admin,
        )
      ).status,
      404,
    );
  } finally {
    child.kill();
    await db.$disconnect();
  }
});
