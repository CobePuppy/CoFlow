import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

test('常用视图账号团队隔离、版本冲突与通知分页及批量已读权限', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const base = 'http://127.0.0.1:3105/api/v1',
    origin = 'http://localhost:5173';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        COFLOW_IMPORT_ONLY: '',
        PORT: '3105',
        APP_ORIGIN: origin,
      },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stderr.on('data', (d) => (output += d.toString()));
  async function send(path: string, method = 'GET', data?: any, auth?: any) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: (await response.json()) as any };
  }
  async function register(tag: string) {
    const email = `views-${tag}-${randomUUID()}@example.com`,
      password = 'Views-test-2026!';
    const team = await send('/auth/register', 'POST', {
      kind: 'creator',
      name: tag,
      email,
      password,
      teamName: '视图团队' + tag,
    });
    assert.equal(team.status, 201);
    const response = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    const auth: any = await response.json();
    return {
      ...auth,
      workspaceId: team.data.workspaceId,
      cookie: response.headers.get('set-cookie')!.split(';')[0],
    };
  }
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + '/health')).ok) break;
      } catch {}
      assert(i < 100, output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const a = await register('A'),
      b = await register('B'),
      outsider = await register('C');
    const pa = (
      await send(
        `/workspaces/${a.workspaceId}/projects`,
        'POST',
        { name: 'A项目' },
        a,
      )
    ).data;
    const pb = (
      await send(
        `/workspaces/${b.workspaceId}/projects`,
        'POST',
        { name: 'B项目' },
        b,
      )
    ).data;
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: a.workspaceId, userId: b.user.id },
        { workspaceId: b.workspaceId, userId: a.user.id },
      ],
    });
    await db.projectMember.createMany({
      data: [
        { projectId: pa.id, userId: b.user.id, roles: ['PRODUCT'] },
        { projectId: pb.id, userId: a.user.id, roles: ['PRODUCT'] },
      ],
    });
    const path = `/workspaces/${a.workspaceId}/views`;
    const content = {
      name: '我的风险需求',
      view: 'tasks',
      mode: 'board',
      projectId: pa.id,
      filters: { scope: 'overdue', priority: 'P1' },
    };
    let view = await send(path, 'POST', content, a);
    assert.equal(view.status, 201);
    const id = view.data.id;
    assert.equal((await send(path, 'POST', content, a)).status, 409);
    assert.equal(
      (
        await send(
          path,
          'POST',
          { ...content, name: '非法项目', projectId: pb.id },
          a,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await send(
          path,
          'POST',
          { ...content, name: '非法字段', filters: { role: 'ADMIN' } },
          a,
        )
      ).status,
      422,
    );
    assert.equal((await send(path, 'GET', undefined, b)).data.items.length, 0);
    assert.equal(
      (await send(`/workspaces/${b.workspaceId}/views`, 'GET', undefined, a))
        .data.items.length,
      0,
    );
    assert.equal((await send(path, 'GET', undefined, outsider)).status, 404);
    assert.equal(
      (
        await send(
          path + '/' + id,
          'PATCH',
          { ...content, expectedVersion: 1 },
          b,
        )
      ).status,
      409,
    );
    view = await send(
      path + '/' + id,
      'PATCH',
      { ...content, name: '重命名视图', expectedVersion: 1 },
      a,
    );
    assert.equal(view.status, 200);
    assert.equal(view.data.version, 2);
    assert.equal(
      (await send(path + '/' + id, 'DELETE', { expectedVersion: 1 }, a)).status,
      409,
    );
    assert.equal(
      (
        await send(
          path + '/' + id,
          'PATCH',
          { ...content, expectedVersion: 1 },
          a,
        )
      ).status,
      409,
    );
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: pa.id, userId: a.user.id } },
    });
    assert.equal((await send(path, 'GET', undefined, a)).data.items.length, 0);
    assert.equal(
      (await send(path, 'POST', { ...content, name: '失去项目权限' }, a))
        .status,
      404,
    );
    await db.projectMember.create({
      data: { projectId: pa.id, userId: a.user.id, roles: ['PRODUCT'] },
    });
    const ta = (
      await send(
        `/projects/${pa.id}/tasks`,
        'POST',
        { title: '通知A', productId: a.user.id },
        a,
      )
    ).data;
    const tb = (
      await send(
        `/projects/${pb.id}/tasks`,
        'POST',
        { title: '通知B', productId: b.user.id },
        b,
      )
    ).data;
    const ids = Array.from({ length: 25 }, () => randomUUID());
    const otherId = randomUUID(),
      otherTeam = randomUUID();
    await db.notification.createMany({
      data: [
        ...ids.map((id, index) => ({
          id,
          recipientId: a.user.id,
          workspaceId: a.workspaceId,
          projectId: pa.id,
          taskId: ta.id,
          message: `通知-${index}`,
          dedupe: id,
          createdAt: new Date('2026-10-18T00:00:00Z'),
        })),
        {
          id: otherId,
          recipientId: b.user.id,
          workspaceId: a.workspaceId,
          projectId: pa.id,
          taskId: ta.id,
          message: '其他账号',
          dedupe: otherId,
        },
        {
          id: otherTeam,
          recipientId: a.user.id,
          workspaceId: b.workspaceId,
          projectId: pb.id,
          taskId: tb.id,
          message: '其他团队',
          dedupe: otherTeam,
        },
      ],
    });
    const notices = `/notifications?workspace=${a.workspaceId}`;
    let first = await send(notices, 'GET', undefined, a);
    assert.equal(first.data.total, 25);
    assert.equal(first.data.unreadCount, 25);
    assert.equal(first.data.items.length, 20);
    const second = await send(notices + '&page=2', 'GET', undefined, a);
    assert.equal(second.data.items.length, 5);
    assert.equal(
      new Set([...first.data.items, ...second.data.items].map((n) => n.id))
        .size,
      25,
    );
    assert.equal(
      (await send(notices + '&unread=invalid', 'GET', undefined, a)).status,
      422,
    );
    assert.equal(
      (
        await send(
          '/notifications/read',
          'POST',
          { workspaceId: a.workspaceId, ids: [ids[0], otherId] },
          a,
        )
      ).status,
      404,
    );
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: ids[0] } }))
        .readAt,
      null,
    );
    assert.equal(
      (
        await send(
          '/notifications/read',
          'POST',
          { workspaceId: a.workspaceId, ids: [ids[0], otherTeam] },
          a,
        )
      ).status,
      404,
    );
    let marked = await send(
      '/notifications/read',
      'POST',
      { workspaceId: a.workspaceId, ids: [ids[0], ids[0], ids[1]] },
      a,
    );
    assert.equal(marked.status, 200);
    assert.equal(marked.data.count, 2);
    marked = await send(
      '/notifications/read',
      'POST',
      { workspaceId: a.workspaceId, ids: [ids[0], ids[1]] },
      a,
    );
    assert.equal(marked.data.count, 0);
    first = await send(notices + '&unread=true&page=2', 'GET', undefined, a);
    assert.equal(first.data.total, 23);
    assert.equal(first.data.items.length, 3);
    assert.equal(first.data.unreadCount, 23);
    assert.equal(
      (
        await send(
          '/notifications/read',
          'POST',
          { workspaceId: a.workspaceId, all: true },
          outsider,
        )
      ).status,
      404,
    );
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: pa.id, userId: a.user.id } },
    });
    assert.equal(
      (
        await send(
          '/notifications/read',
          'POST',
          { workspaceId: a.workspaceId, ids: [ids[2]] },
          a,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await send(
          '/notifications/read',
          'POST',
          { workspaceId: a.workspaceId, all: true },
          a,
        )
      ).data.count,
      0,
    );
    assert.equal((await send(notices, 'GET', undefined, a)).data.total, 0);
    await db.projectMember.create({
      data: { projectId: pa.id, userId: a.user.id, roles: ['PRODUCT'] },
    });
    marked = await send(
      '/notifications/read',
      'POST',
      { workspaceId: a.workspaceId, all: true },
      a,
    );
    assert.equal(marked.data.count, 23);
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: otherId } }))
        .readAt,
      null,
    );
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: otherTeam } }))
        .readAt,
      null,
    );
    assert.equal(
      (await send(path + '/' + id, 'DELETE', { expectedVersion: 2 }, a)).status,
      200,
    );
    assert.equal((await send(path, 'GET', undefined, a)).data.items.length, 0);
  } finally {
    child.kill();
    await db.$disconnect();
  }
});
