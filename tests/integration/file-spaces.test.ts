import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

test('独立文件空间：个人隔离、无项目团队共享、撤权、版本冲突、审计回滚及清理保护', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const base = 'http://127.0.0.1:3106/api/v1',
    origin = 'http://localhost:5173';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        COFLOW_IMPORT_ONLY: '',
        PORT: '3106',
        APP_ORIGIN: origin,
        STORAGE_DIR: './storage-test',
      },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stderr.on('data', (b) => (output += b.toString()));
  async function send(route: string, method = 'GET', data?: any, auth?: any) {
    const response = await fetch(base + route, {
      method,
      headers: {
        Origin: origin,
        ...(data instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}),
      },
      ...(data === undefined
        ? {}
        : { body: data instanceof FormData ? data : JSON.stringify(data) }),
    });
    const body = await response.text();
    let result: any;
    try {
      result = JSON.parse(body);
    } catch {
      result = body;
    }
    return { status: response.status, data: result };
  }
  async function register(tag: string) {
    const email = 'files-' + tag + '-' + randomUUID() + '@example.com',
      password = 'Files-test-2026!';
    const reg = await send('/auth/register', 'POST', {
      kind: 'creator',
      name: tag,
      email,
      password,
      teamName: '独立文件团队' + tag,
    });
    assert.equal(reg.status, 201);
    const response = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    return {
      ...((await response.json()) as any),
      workspaceId: reg.data.workspaceId,
      cookie: response.headers.get('set-cookie')!.split(';')[0],
    };
  }
  async function upload(
    route: string,
    auth: any,
    name = 'dev-guide.md',
    mime = 'text/markdown',
  ) {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['# 开发规范\n所有提交需要说明验证结果。'], { type: mime }),
      name,
    );
    return send(route, 'POST', form, auth);
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
    const team = '/workspaces/' + a.workspaceId + '/files';
    assert.equal(
      await db.project.count({ where: { workspaceId: a.workspaceId } }),
      0,
    );
    const personal = await upload('/me/files', a);
    assert.equal(personal.status, 201, JSON.stringify(personal.data));
    const personalB = await upload('/me/files', b);
    assert.equal(personalB.status, 201);
    assert.equal((await send('/me/files', 'GET', undefined, b)).data.total, 1);
    assert.equal(
      (
        await send(
          '/space-files/' + personal.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + personalB.data.id + '/download',
          'GET',
          undefined,
          a,
        )
      ).status,
      404,
    );
    assert.equal((await send(team, 'GET', undefined, b)).status, 404);
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: b.user.id },
    });
    let file = (await upload(team, b)).data;
    assert(file.id);
    assert.equal(
      (await send(team + '?q=DEV-GUIDE&pageSize=1', 'GET', undefined, a)).data
        .total,
      1,
    );
    assert.equal(
      (await send('/space-files/' + file.id + '/download', 'GET', undefined, a))
        .status,
      200,
    );
    assert.equal(
      (await send('/space-files/' + file.id + '/download', 'GET', undefined, c))
        .status,
      404,
    );
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: c.user.id },
    });
    assert.equal(
      (
        await send(
          '/space-files/' + file.id,
          'DELETE',
          { expectedVersion: file.version },
          c,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + file.id,
          'PATCH',
          { expectedVersion: file.version, name: '../outside.md' },
          a,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + file.id,
          'PATCH',
          { expectedVersion: file.version, name: 'wrong.exe' },
          a,
        )
      ).status,
      422,
    );
    const renamed = await send(
      '/space-files/' + file.id,
      'PATCH',
      { expectedVersion: file.version, name: 'team-standard.md' },
      a,
    );
    assert.equal(renamed.status, 200);
    file = renamed.data;
    assert.equal(
      (
        await send(
          '/space-files/' + file.id,
          'PATCH',
          { expectedVersion: 1, name: 'stale.md' },
          b,
        )
      ).status,
      409,
    );
    const removed = await send(
      '/space-files/' + file.id,
      'DELETE',
      { expectedVersion: file.version },
      b,
    );
    assert.equal(removed.status, 200);
    file = removed.data;
    assert.equal(
      (await send('/space-files/' + file.id + '/download', 'GET', undefined, a))
        .status,
      404,
    );
    assert.equal(
      (await send(team + '?deleted=true', 'GET', undefined, c)).data.total,
      0,
    );
    assert.equal(
      (await send(team + '?deleted=true', 'GET', undefined, a)).data.total,
      1,
    );
    const restored = await send(
      '/space-files/' + file.id + '/restore',
      'POST',
      { expectedVersion: file.version },
      a,
    );
    assert.equal(restored.status, 200);
    file = restored.data;
    const revoked = await send(
      '/workspaces/' + a.workspaceId + '/members/' + b.user.id,
      'DELETE',
      {},
      a,
    );
    assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
    assert.equal((await send(team, 'GET', undefined, b)).status, 404);
    assert.equal(
      (await send('/space-files/' + file.id + '/download', 'GET', undefined, b))
        .status,
      404,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + personalB.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send('/space-files/' + file.id + '/download', 'GET', undefined, a))
        .status,
      200,
    );
    const events = await db.spaceFileEvent.findMany({
      where: { fileId: file.id },
    });
    assert.equal(events.length, 4);
    await assert.rejects(() =>
      db.spaceFile.update({
        where: { id: file.id },
        data: { workspaceId: c.workspaceId },
      }),
    );
    await assert.rejects(() =>
      db.spaceFile.create({
        data: {
          scope: 'PERSONAL',
          ownerId: a.user.id,
          workspaceId: a.workspaceId,
          userId: a.user.id,
          key: 'sf-' + randomUUID(),
          name: 'bad.txt',
          mime: 'text/plain',
          size: 1,
        },
      }),
    );
    assert.equal(
      (await upload('/me/files', a, 'invalid.exe', 'application/octet-stream'))
        .status,
      422,
    );
    const root = path.resolve('storage-test');
    const before = (await fs.readdir(root))
      .filter((f) => f.startsWith('sf-'))
      .sort();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_space_file_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER fail_space_file_audit BEFORE INSERT ON "SpaceFileEvent" FOR EACH ROW EXECUTE FUNCTION fail_space_file_audit()',
    );
    try {
      assert.equal(
        (await upload('/me/files', a, 'rollback.txt', 'text/plain')).status,
        500,
      );
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER fail_space_file_audit ON "SpaceFileEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION fail_space_file_audit()');
    }
    assert.deepEqual(
      (await fs.readdir(root)).filter((f) => f.startsWith('sf-')).sort(),
      before,
    );
    const metadata = await db.spaceFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    const old = new Date(Date.now() - 2 * 86400000);
    await fs.utimes(path.join(root, metadata.key), old, old);
    const cleanup = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/maintenance/storage-cleanup.ts'],
      {
        env: { ...process.env, DATABASE_URL: url, STORAGE_DIR: root },
        stdio: 'pipe',
      },
    );
    let cleanupOutput = '';
    cleanup.stdout.on('data', (b) => (cleanupOutput += b));
    cleanup.stderr.on('data', (b) => (cleanupOutput += b));
    assert.equal(
      await new Promise((resolve) => cleanup.on('exit', resolve)),
      0,
      cleanupOutput,
    );
    assert(!cleanupOutput.includes(metadata.key));
    assert(
      (await fs.readFile(path.join(root, metadata.key), 'utf8')).includes(
        '开发规范',
      ),
    );
  } finally {
    child.kill();
    await db.$disconnect();
  }
});
