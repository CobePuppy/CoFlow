import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

test('文件查找：分类、本人上传、排序、分页及组合权限', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const base = 'http://127.0.0.1:3110/api/v1',
    origin = 'http://localhost:5173';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        COFLOW_IMPORT_ONLY: '',
        PORT: '3110',
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
      b = await register('B');
    await db.workspaceMember.create({
      data: { workspaceId: a.workspaceId, userId: b.user.id },
    });
    const team = '/workspaces/' + a.workspaceId + '/files';
    for (let i = 0; i < 23; i++)
      assert.equal(
        (
          await upload(
            team,
            i % 2 ? a : b,
            '规范-' + String(i).padStart(2, '0') + '.md',
          )
        ).status,
        201,
      );
    const form = new FormData();
    form.append(
      'file',
      new Blob(['%PDF-1.4\n' + 'x'.repeat(100)], { type: 'application/pdf' }),
      '手册.pdf',
    );
    const pdf = await send(team, 'POST', form, a);
    assert.equal(pdf.status, 201);
    for (const sort of ['newest', 'updated', 'name', 'size']) {
      const orderBy: any = [
        sort === 'name'
          ? { name: 'asc' }
          : sort === 'size'
            ? { size: 'desc' }
            : sort === 'updated'
              ? { updatedAt: 'desc' }
              : { createdAt: 'desc' },
        { id: 'asc' },
      ];
      const expected = await db.spaceFile.findMany({
        where: { workspaceId: a.workspaceId, deletedAt: null },
        orderBy,
      });
      const first = await send(
          team + '?sort=' + sort + '&pageSize=20',
          'GET',
          undefined,
          a,
        ),
        second = await send(
          team + '?sort=' + sort + '&page=2&pageSize=20',
          'GET',
          undefined,
          a,
        );
      assert.equal(first.status, 200);
      assert.equal(first.data.total, 24);
      assert.deepEqual(
        [...first.data.items, ...second.data.items].map((f: any) => f.id),
        expected.map((f) => f.id),
      );
    }
    const filtered = await send(
      team + '?type=TEXT&uploader=MINE&q=规范&pageSize=3&page=2',
      'GET',
      undefined,
      a,
    );
    assert.equal(filtered.data.total, 11);
    assert.equal(filtered.data.items.length, 3);
    assert(
      filtered.data.items.every(
        (f: any) => f.userId === a.user.id && f.mime === 'text/markdown',
      ),
    );
    assert.equal(
      (await send(team + '?type=PDF', 'GET', undefined, b)).data.total,
      1,
    );
    assert.equal(
      (await send(team + '?type=IMAGE', 'GET', undefined, a)).data.total,
      0,
    );
    for (const q of ['type=UNKNOWN', 'sort=key', 'uploader=someone'])
      assert.equal(
        (await send(team + '?' + q, 'GET', undefined, a)).status,
        422,
      );
    assert.equal((await upload('/me/files', a, '私人.md')).status, 201);
    assert.equal(
      (await send('/me/files?type=TEXT&uploader=MINE', 'GET', undefined, b))
        .data.total,
      0,
    );
    const deleted = await send(
      '/space-files/' + pdf.data.id,
      'DELETE',
      { expectedVersion: pdf.data.version },
      a,
    );
    assert.equal(deleted.status, 200);
    assert.equal(
      (await send(team + '?deleted=true&type=PDF', 'GET', undefined, b)).data
        .total,
      0,
    );
    assert.equal(
      (await send(team + '?deleted=true&type=PDF', 'GET', undefined, a)).data
        .total,
      1,
    );
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: a.workspaceId, userId: b.user.id },
      },
    });
    assert.equal(
      (await send(team + '?type=TEXT&uploader=MINE', 'GET', undefined, b))
        .status,
      404,
    );
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
