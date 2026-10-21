import 'dotenv/config';
import { discussionView } from '../../packages/contracts/src/discussion.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
test('讨论与决策：回复、权限、需求版本、并发和归档保护', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3109/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3109',
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

    const root = '/tasks/' + t.id + '/comments';
    const version = async () =>
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).version;
    const post = async (body: any, who = a) =>
      send(
        root,
        'POST',
        { expectedVersion: await version(), body: '澄清范围', ...body },
        who,
      );
    const old = await post({});
    assert.equal(old.status, 200);
    const question = await post({ kind: 'QUESTION' });
    assert.equal(question.status, 200);
    assert.equal(question.data.requirementVersion, t.data.requirementVersion);
    const reply = await post(
      { replyTo: question.data.id, body: '答复范围' },
      b,
    );
    assert.equal(reply.status, 200);
    assert.equal((await post({ replyTo: reply.data.id })).status, 404);
    assert.equal(
      (await post({ replyTo: question.data.id, kind: 'DECISION' })).status,
      422,
    );
    assert.equal((await post({ kind: 'QUESTION' }, c)).status, 404);
    assert.equal((await post({ body: '   ' })).status, 422);
    const change = async (
      resolved: boolean,
      who = a,
      expectedVersion?: number,
    ) =>
      send(
        root + '/' + question.data.id,
        'PATCH',
        {
          expectedVersion: expectedVersion ?? (await version()),
          resolved,
          reason: '已对齐边界',
        },
        who,
      );
    assert.equal((await change(true, b)).status, 403);
    const stale = await version();
    assert.equal((await change(true)).status, 200);
    assert.equal((await change(false, a, stale)).status, 409);
    assert.equal((await change(false)).status, 200);
    const latest = (await send(root, 'GET', undefined, a)).data;
    const q = discussionView(latest).find(
      (x: any) => x.id === question.data.id,
    );
    assert(q);
    assert(q.resolutions);
    assert.equal(q.resolved, false);
    assert.equal(q.resolutions.length, 2);
    assert.equal(
      (await post({ kind: 'DECISION', body: '采用分阶段验收' })).status,
      200,
    );
    const before = await version();
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: new Date() },
    });
    assert.equal((await change(true)).status, 409);
    assert.equal((await post({})).status, 409);
    assert.equal(await version(), before);
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
