import { storedFiles } from '../../scripts/maintenance/storage-files.js';
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

test('文件内容版本：不可改写、并发、固定与跟随引用、历史恢复、权限及存储保护', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const base = 'http://127.0.0.1:3112/api/v1',
    origin = 'http://localhost:5173';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        COFLOW_IMPORT_ONLY: '',
        PORT: '3112',
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
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: b.user.id },
    });
    const p = (
      await send(
        '/workspaces/' + a.workspaceId + '/projects',
        'POST',
        { name: '文件版本项目', workflow: 'SIMPLE' },
        a,
      )
    ).data;
    await db.projectMember.create({
      data: { projectId: p.id, userId: b.user.id, roles: ['ENGINEER'] },
    });
    const task = async (title: string) =>
      (
        await send(
          '/projects/' + p.id + '/tasks',
          'POST',
          { title, productId: a.user.id, engineerId: b.user.id },
          a,
        )
      ).data;
    const follow = await task('跟随需求'),
      fixed = await task('固定需求');
    const f = (await upload('/workspaces/' + a.workspaceId + '/files', a)).data;
    assert.equal(f.contentVersion, 1);
    const orig = await db.spaceFile.findUniqueOrThrow({ where: { id: f.id } });
    const version = async (id: string) =>
      (await db.task.findUniqueOrThrow({ where: { id } })).version;
    const link = async (t: any, file: any, pin: number | null) =>
      send(
        '/tasks/' + t.id + '/resources',
        'POST',
        {
          expectedVersion: await version(t.id),
          kind: 'FILE',
          sourceId: file.id,
          sourceVersion: file.version,
          fileVersion: pin,
          sharePersonal: true,
        },
        a,
      );
    const lf = await link(follow, f, null),
      lp = await link(fixed, f, 1);
    assert.equal(lf.status, 201);
    assert.equal(lp.status, 201);
    const revise = async (
      file: any,
      text: string,
      expected = file.version,
      who = a,
    ) => {
      const data = new FormData();
      data.append(
        'file',
        new Blob([text], { type: 'text/markdown' }),
        '新规范.md',
      );
      data.append('expectedVersion', String(expected));
      data.append('summary', '补充开发规范');
      return send('/space-files/' + file.id + '/revisions', 'POST', data, who);
    };
    assert.equal((await revise(f, '越权', 1, b)).status, 403);
    const concurrent = await Promise.all([
      revise(f, '版本二内容A'),
      revise(f, '版本二内容B'),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
    const newer = concurrent.find((r) => r.status === 201)!.data;
    assert.equal(newer.contentVersion, 2);
    assert.equal(
      (await db.spaceFile.findUniqueOrThrow({ where: { id: f.id } })).key,
      orig.key,
    );
    const latest = (
        await send('/tasks/' + follow.id + '/resources', 'GET', undefined, b)
      ).data[0],
      pin = (
        await send('/tasks/' + fixed.id + '/resources', 'GET', undefined, b)
      ).data[0];
    assert.equal(latest.status, 'UPDATED');
    assert.equal(pin.status, 'CURRENT');
    assert.equal(pin.fileVersion, 1);
    assert.equal(pin.latestContentVersion, 2);
    const originalBytes = (
      await send(
        '/space-files/' + f.id + '/revisions/1/download',
        'GET',
        undefined,
        a,
      )
    ).data;
    assert.equal(
      (
        await send(
          '/tasks/' + fixed.id + '/resources/' + lp.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).data,
      originalBytes,
    );
    assert.notEqual(
      (
        await send(
          '/tasks/' + follow.id + '/resources/' + lf.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).data,
      originalBytes,
    );
    const restored = await send(
      '/space-files/' + f.id + '/revisions/1/restore',
      'POST',
      { expectedVersion: newer.version, summary: '回退核对内容' },
      a,
    );
    assert.equal(restored.status, 201);
    assert.equal(restored.data.contentVersion, 3);
    assert.equal(
      (await send('/space-files/' + f.id + '/download', 'GET', undefined, a))
        .data,
      originalBytes,
    );
    assert.equal(
      await db.spaceFileRevision.count({ where: { fileId: f.id } }),
      3,
    );
    const keys = (await storedFiles(db)).map((row) => row.key),
      rows = await db.spaceFileRevision.findMany({ where: { fileId: f.id } });
    for (const row of rows) assert(keys.includes(row.key));
    assert.equal(new Set(keys).size, keys.length);
    await assert.rejects(
      db.spaceFileRevision.update({
        where: { fileId_number: { fileId: f.id, number: 1 } },
        data: { summary: '不可覆盖' },
      }),
    );
    await assert.rejects(
      db.spaceFile.update({ where: { id: f.id }, data: { size: 999 } }),
    );
    assert.equal(
      (await send('/space-files/' + f.id + '/revisions', 'GET', undefined, c))
        .status,
      404,
    );
    assert.equal(
      (
        await send(
          '/tasks/' + fixed.id + '/resources/' + lp.data.id + '/refresh',
          'POST',
          {
            expectedVersion: await version(fixed.id),
            sourceVersion: restored.data.version,
            fileVersion: null,
          },
          a,
        )
      ).status,
      204,
    );
    assert.equal(
      (await send('/tasks/' + fixed.id + '/resources', 'GET', undefined, b))
        .data[0].fileVersion,
      null,
    );
    const privateFile = (await upload('/me/files', a)).data,
      privateRef = await link(fixed, privateFile, 1);
    assert.equal(privateRef.status, 201);
    assert.equal(
      (
        await send(
          '/space-files/' + privateFile.id + '/revisions',
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
          '/tasks/' +
            fixed.id +
            '/resources/' +
            privateRef.data.id +
            '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await send(
          '/space-files/' +
            privateFile.id +
            '/references/' +
            privateRef.data.id,
          'DELETE',
          undefined,
          a,
        )
      ).status,
      204,
    );
    assert.equal(
      (
        await send(
          '/tasks/' +
            fixed.id +
            '/resources/' +
            privateRef.data.id +
            '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
    await db.projectMember.update({
      where: { projectId_userId: { projectId: p.id, userId: b.user.id } },
      data: { roles: ['PRODUCT', 'ENGINEER'] },
    });
    const privateTask = (
      await send(
        '/projects/' + p.id + '/tasks',
        'POST',
        {
          title: '私人版本授权边界',
          productId: b.user.id,
          engineerId: b.user.id,
        },
        b,
      )
    ).data;
    const narrow = await link(privateTask, privateFile, 1);
    assert.equal(narrow.status, 201);
    const narrowRoot = '/tasks/' + privateTask.id + '/resources';
    assert.equal(
      (await send(narrowRoot, 'GET', undefined, b)).data[0].canChangeFileMode,
      false,
    );
    assert.equal(
      (
        await send(
          narrowRoot + '/' + narrow.data.id + '/refresh',
          'POST',
          {
            expectedVersion: await version(privateTask.id),
            sourceVersion: privateFile.version,
            fileVersion: null,
          },
          b,
        )
      ).status,
      403,
    );
    const audit = 'reject_revision_' + Date.now();
    await db.$executeRawUnsafe(
      'CREATE FUNCTION ' +
        audit +
        "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SPACE_FILE_REVISION' THEN RAISE EXCEPTION 'rollback'; END IF; RETURN NEW; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER ' +
        audit +
        ' BEFORE INSERT ON "SpaceFileEvent" FOR EACH ROW EXECUTE FUNCTION ' +
        audit +
        '()',
    );
    const beforeKeys = new Set(await fs.readdir('./storage-test'));
    try {
      assert.equal((await revise(restored.data, '必须回滚')).status, 500);
      assert.equal(
        await db.spaceFileRevision.count({ where: { fileId: f.id } }),
        3,
      );
      assert.deepEqual(new Set(await fs.readdir('./storage-test')), beforeKeys);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER ' + audit + ' ON "SpaceFileEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION ' + audit + '()');
    }
    assert.equal(
      (
        await send(
          '/space-files/' + f.id,
          'DELETE',
          { expectedVersion: restored.data.version },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + f.id + '/revisions/1/download',
          'GET',
          undefined,
          a,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await send(
          '/tasks/' + fixed.id + '/resources/' + lp.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
