import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

test('QQ PostgreSQL 集成：绑定、一次性码、团队隔离、权限撤销与令牌', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname.endsWith('/coflow_test') &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const user = await db.user.findUniqueOrThrow({
    where: { email: 'engineer@coflow.local' },
  });
  const team = await db.workspaceMember.findFirstOrThrow({
    where: { userId: user.id },
  });
  const token = randomBytes(32).toString('hex'),
    base = 'http://127.0.0.1:3103/api/v1';
  const qq = String(100000000 + Math.floor(Math.random() * 900000000));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        COFLOW_IMPORT_ONLY: '',
        PORT: '3103',
        QQ_BOT_TOKEN: token,
        QQ_BOT_WORKSPACE_ID: team.workspaceId,
        QQ_BOT_WEB_URL: 'https://coflow.example',
      },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stderr.on('data', (d) => {
    output += d;
  });
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + '/health')).ok) break;
      } catch {}
      if (i > 100) throw new Error(output);
      await new Promise((r) => setTimeout(r, 100));
    }
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        email: user.email,
        password: process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!',
      }),
    });
    assert.equal(login.status, 200);
    const session: any = await login.json();
    const account = async (
      path: string,
      method = 'GET',
      csrf = session.csrf,
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Cookie: login.headers.get('set-cookie')!.split(';')[0],
          Origin: 'http://localhost:5173',
          'X-CSRF-Token': csrf,
        },
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    const bot = async (
      path: string,
      method = 'GET',
      body?: any,
      auth = token,
      origin = '',
    ) => {
      const response = await fetch(base + '/integrations/qq' + path, {
        method,
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    const bindingPath = `/workspaces/${team.workspaceId}/qq-binding`;
    await account(bindingPath, 'DELETE');
    assert.equal(
      (await account(bindingPath + '/code', 'POST', 'bad')).status,
      403,
    );
    assert.equal(
      (await bot('/recipients', 'GET', undefined, 'invalid')).status,
      401,
    );
    assert.equal(
      (await bot('/recipients', 'GET', undefined, token, 'http://evil.example'))
        .status,
      403,
    );
    const first = await account(bindingPath + '/code', 'POST');
    assert.equal(first.status, 200);
    const second = await account(bindingPath + '/code', 'POST');
    assert.equal(
      (await bot('/bind', 'POST', { qq, code: first.data.code })).status,
      422,
    );
    const race = await Promise.all([
      bot('/bind', 'POST', { qq, code: second.data.code }),
      bot('/bind', 'POST', { qq, code: second.data.code }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 422]);
    assert.equal((await account(bindingPath)).data.qq, qq);
    const work = await bot(`/work?qq=${qq}`);
    assert.equal(work.status, 200);
    for (const item of work.data.items) {
      const task = await db.task.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(task.workspaceId, team.workspaceId);
      assert.equal(new URL(item.url).origin, 'https://coflow.example');
    }
    assert((await bot('/recipients')).data.items.some((i: any) => i.qq === qq));
    const unrelated = await db.workspace.findFirstOrThrow({
      where: { id: { not: team.workspaceId } },
    });
    assert.equal(
      (await account(`/workspaces/${unrelated.id}/qq-binding/code`, 'POST'))
        .status,
      404,
    );
    assert.equal((await bot(`/work?qq=${qq}&mode=oops`)).status, 422);
    // Removing project membership must take effect immediately, without trusting cached bindings.
    const memberships = await db.projectMember.findMany({
      where: { userId: user.id },
    });
    const original = await db.qQBinding.findUniqueOrThrow({
      where: {
        workspaceId_userId: { workspaceId: team.workspaceId, userId: user.id },
      },
    });
    const outsider = await db.user.create({
      data: {
        email: `${qq}@qq-test.local`,
        name: '无项目成员',
        password: 'unused',
      },
    });
    try {
      await db.workspaceMember.create({
        data: { workspaceId: team.workspaceId, userId: outsider.id },
      });
      await db.qQBinding.update({
        where: {
          workspaceId_userId: {
            workspaceId: team.workspaceId,
            userId: user.id,
          },
        },
        data: { userId: outsider.id },
      });
      assert.equal((await bot(`/work?qq=${qq}`)).data.total, 0);
      await db.workspaceMember.delete({
        where: {
          workspaceId_userId: {
            workspaceId: team.workspaceId,
            userId: outsider.id,
          },
        },
      });
      assert.equal((await bot(`/work?qq=${qq}`)).status, 403);
      assert(
        !(await bot('/recipients')).data.items.some((i: any) => i.qq === qq),
      );
    } finally {
      await db.qQBinding.deleteMany({
        where: { workspaceId: team.workspaceId, qq },
      });
      await db.workspaceMember.deleteMany({ where: { userId: outsider.id } });
      await db.user.delete({ where: { id: outsider.id } });
      await db.qQBinding.create({ data: original });
    }
    assert(memberships.length > 0);
    await account(bindingPath, 'DELETE');
    assert.equal((await bot(`/work?qq=${qq}`)).status, 404);
    const expired = await account(bindingPath + '/code', 'POST');
    await db.qQBindingCode.updateMany({
      where: { userId: user.id, workspaceId: team.workspaceId },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      (await bot('/bind', 'POST', { qq, code: expired.data.code })).status,
      422,
    );
    await account(bindingPath, 'DELETE');
  } finally {
    child.kill();
    await db.$disconnect();
  }
});
