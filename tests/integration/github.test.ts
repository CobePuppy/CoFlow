import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  encryptKey,
  decryptKey,
} from '../../apps/api/src/infrastructure/security/encryption.js';

test('GitHub 需求关联、个人私有授权、引用快照、冲突与归档权限', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  const db = new PrismaClient({ datasources: { db: { url } } });
  process.env.SETTINGS_ENCRYPTION_KEY = '1'.repeat(64);
  async function adjustStored(
    userId: string,
    field: 'attempt' | 'credentials',
    update: any,
  ) {
    const row = await db.gitHubAccount.findUniqueOrThrow({ where: { userId } });
    const data = { ...JSON.parse(decryptKey(row[field]!, userId)), ...update };
    await db.gitHubAccount.update({
      where: { userId },
      data: { [field]: encryptKey(JSON.stringify(data), userId) },
    });
  }
  const base = 'http://127.0.0.1:3106/api/v1',
    origin = 'http://localhost:5173';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/github-server.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3106',
        APP_ORIGIN: origin,
        GITHUB_APP_CLIENT_ID: 'test-app',
        GITHUB_APP_SLUG: 'test-app',
        SETTINGS_ENCRYPTION_KEY: '1'.repeat(64),
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
  async function register() {
    const email = `github-${randomUUID()}@example.com`,
      password = 'GitHub-test-2026!';
    const registered = await send('/auth/register', 'POST', {
      kind: 'creator',
      email,
      password,
      name: 'GitHub测试',
      teamName: 'GitHub测试团队',
    });
    assert.equal(registered.status, 201);
    const response = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return {
      ...((await response.json()) as any),
      workspaceId: registered.data.workspaceId,
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
    const owner = await register(),
      reader = await register(),
      outsider = await register();
    const project = (
      await send(
        `/workspaces/${owner.workspaceId}/projects`,
        'POST',
        { name: 'GitHub测试项目' },
        owner,
      )
    ).data;
    await db.workspaceMember.create({
      data: { workspaceId: owner.workspaceId, userId: reader.user.id },
    });
    await db.projectMember.create({
      data: { projectId: project.id, userId: reader.user.id, roles: ['QA'] },
    });
    const t = (
      await send(
        `/projects/${project.id}/tasks`,
        'POST',
        { title: 'GitHub需求', productId: owner.user.id },
        owner,
      )
    ).data;
    assert(t.id);
    const path = `/tasks/${t.id}/github`;
    assert.equal(
      (
        await send(
          path,
          'PUT',
          { repository: 'demo/public', version: 0 },
          owner,
        )
      ).status,
      200,
    );
    let b = (await send(path, 'GET', undefined, owner)).data;
    assert.equal(b.version, 1);
    assert.equal((await send(path, 'GET', undefined, outsider)).status, 404);
    assert.equal(
      (await send(path + '/tree', 'GET', undefined, reader)).data.items[0].name,
      'README.md',
    );
    assert.equal(
      (await send(path + '/file?path=README.md', 'GET', undefined, reader)).data
        .text,
      '# CoFlow repository context\n',
    );
    assert.equal(
      (await send(path + '/file?path=../secret', 'GET', undefined, owner))
        .status,
      422,
    );
    assert.equal(
      (await send(path + '/file?path=submodule', 'GET', undefined, owner))
        .status,
      422,
    );
    assert.equal(
      (
        await send(
          path + '/references',
          'POST',
          { version: 1, path: 'README.md' },
          reader,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          path + '/references',
          'POST',
          { version: 1, path: 'README.md' },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await send(
          path,
          'PUT',
          { repository: 'demo/public', branch: 'next', version: 1 },
          owner,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          path,
          'PUT',
          { repository: 'demo/public', branch: 'next', version: 2 },
          owner,
        )
      ).status,
      200,
    );
    b = (await send(path, 'GET', undefined, owner)).data;
    assert.equal(b.data.commit, 'c'.repeat(40));
    assert.equal(b.data.references[0].commit, 'a'.repeat(40));
    assert.equal(
      (
        await send(
          path + '/file?path=README.md&reference=1',
          'GET',
          undefined,
          reader,
        )
      ).data.commit,
      'a'.repeat(40),
    );
    assert.equal(
      (await send('/github/device', 'POST', {}, owner)).data.code,
      'TEST-CODE',
    );
    assert.equal((await send('/github/device', 'POST', {}, owner)).status, 429);
    assert.equal(
      (await send('/github/device/poll', 'POST', {}, owner)).data.pending,
      true,
    );
    // Wait the actual interval; production never polls GitHub faster than requested.
    await new Promise((resolve) => setTimeout(resolve, 5100));
    assert.equal(
      (await send('/github/device/poll', 'POST', {}, owner)).data.interval,
      5,
    );
    await adjustStored(owner.user.id, 'attempt', { nextPoll: Date.now() - 1 });
    assert.equal(
      (await send('/github/device/poll', 'POST', {}, owner)).data.interval,
      10,
    );
    assert.equal(
      (await send('/github/device/poll', 'POST', {}, owner)).data.pending,
      true,
    );
    await adjustStored(owner.user.id, 'attempt', { nextPoll: Date.now() - 1 });
    assert.equal(
      (await send('/github/device/poll', 'POST', {}, owner)).data.login,
      'github-test',
    );
    const stored = await db.gitHubAccount.findUniqueOrThrow({
      where: { userId: owner.user.id },
    });
    assert(
      stored.credentials &&
        !stored.credentials.includes('ghu_') &&
        !stored.credentials.includes('ghr_'),
    );
    assert.equal(stored.attempt, null);
    const diagnostic = (await send('/github/account', 'GET', undefined, owner))
      .data;
    assert.deepEqual(diagnostic.configuration, {
      clientId: true,
      encryption: true,
      installationLink: true,
    });
    const checked = await send('/github/account/check', 'POST', {}, owner);
    assert.equal(checked.status, 200);
    assert.equal(checked.data.login, 'github-test');
    assert.equal(checked.data.visibleInstallations, 1);
    assert(!JSON.stringify(checked.data).includes('ghu_'));
    assert.equal(
      (await send('/github/account/check', 'POST', {}, outsider)).status,
      403,
    );
    assert.equal(
      (await send('/github/installations', 'GET', undefined, owner)).data
        .items[0].id,
      42,
    );
    assert.equal(
      (
        await send(
          '/github/repositories?installationId=42',
          'GET',
          undefined,
          owner,
        )
      ).data.items[1].name,
      'demo/private',
    );
    assert.equal(
      (
        await send(
          '/github/repositories?installationId=42',
          'GET',
          undefined,
          reader,
        )
      ).status,
      403,
    );
    await adjustStored(owner.user.id, 'credentials', {
      expiresAt: Date.now() - 1,
    });
    assert.equal(
      (
        await send(
          path,
          'PUT',
          { repository: 'demo/private', version: 3 },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await send(
          path + '/references',
          'POST',
          { version: 4, path: 'README.md' },
          owner,
        )
      ).status,
      200,
    );
    const refreshed = await db.gitHubAccount.findUniqueOrThrow({
      where: { userId: owner.user.id },
    });
    assert.equal(
      JSON.parse(decryptKey(refreshed.credentials!, owner.user.id))
        .access_token,
      'ghu_test_refreshed',
    );
    await adjustStored(owner.user.id, 'credentials', {
      expiresAt: Date.now() - 1,
      refresh_token: 'ghr_expired',
    });
    assert.equal(
      (await send(path + '/file?path=README.md', 'GET', undefined, owner))
        .status,
      403,
    );
    assert.equal((await send('/auth/me', 'GET', undefined, owner)).status, 200);
    await db.gitHubAccount.update({
      where: { userId: owner.user.id },
      data: { credentials: refreshed.credentials },
    });
    const inaccessible = (await send(path, 'GET', undefined, reader)).data;
    assert(inaccessible.accessError);
    assert.deepEqual(inaccessible.data.references, []);
    const privateBinding = await db.taskGitHub.findUniqueOrThrow({
      where: { taskId: t.id },
    });
    await db.taskGitHub.update({
      where: { taskId: t.id },
      data: { data: { ...(privateBinding.data as any), pulls: [1] } },
    });
    assert.equal(
      (await send(path + '/pulls/1', 'GET', undefined, reader)).status,
      404,
    );
    assert.equal(
      (await send(path + '/pulls/1', 'GET', undefined, owner)).data.state,
      'merged',
    );
    assert.equal(
      (await send(path + '/file?path=README.md', 'GET', undefined, reader))
        .status,
      404,
    );
    assert.equal(
      (await send(path + '/tree', 'GET', undefined, reader)).status,
      404,
    );
    assert.equal(
      (await send('/github/account', 'GET', undefined, reader)).data.login,
      null,
    );
    await db.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });
    assert.equal(
      (await send(path, 'DELETE', { version: 5 }, owner)).status,
      409,
    );
    assert.equal(
      (await send(path + '/file?path=README.md', 'GET', undefined, owner))
        .status,
      200,
    );
    await db.project.update({
      where: { id: project.id },
      data: { archivedAt: null },
    });
    assert.equal(
      (await send('/github/account', 'DELETE', {}, owner)).status,
      200,
    );
    assert.equal(
      (await send(path + '/file?path=README.md', 'GET', undefined, owner))
        .status,
      404,
    );
    assert.equal(
      (await send(path, 'DELETE', { version: 5 }, owner)).status,
      200,
    );
    assert.equal(
      (
        await send(
          path,
          'PUT',
          { repository: 'demo/public', version: 6 },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send(path, 'DELETE', { version: 1 }, owner)).status,
      409,
    );
    await db.projectMember.delete({
      where: {
        projectId_userId: { projectId: project.id, userId: reader.user.id },
      },
    });
    assert.equal(
      (await send(path + '/tree', 'GET', undefined, reader)).status,
      403,
    );
    assert.equal(
      (
        await send(
          path,
          'PUT',
          { repository: 'http://127.0.0.1/secrets', version: 7 },
          owner,
        )
      ).status,
      422,
    );
    assert.equal(
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).version,
      t.version,
    );
    await db.projectMember.create({
      data: { projectId: project.id, userId: reader.user.id, roles: ['QA'] },
    });
    const projectPath = `/projects/${project.id}/github`;
    assert.equal(
      (
        await send(
          projectPath,
          'PUT',
          { version: 0, repository: 'demo/public' },
          reader,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          projectPath,
          'PUT',
          { version: 0, repository: 'demo/public' },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await send(
          projectPath,
          'PUT',
          { version: 0, repository: 'demo/public' },
          owner,
        )
      ).status,
      409,
    );
    assert.equal(
      (await send(projectPath, 'GET', undefined, outsider)).status,
      404,
    );
    const delivery = (
      await send(
        `/projects/${project.id}/tasks`,
        'POST',
        {
          title: '交付关联',
          criteria: ['验收A', '验收B'],
          productId: owner.user.id,
        },
        owner,
      )
    ).data;
    const deliveryPath = `/tasks/${delivery.id}/github`;
    assert.equal(
      (
        await send(
          deliveryPath,
          'PUT',
          {
            version: 0,
            repository: 'demo/public',
            branch: 'main',
            inheritVersion: 9,
          },
          owner,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          deliveryPath,
          'PUT',
          {
            version: 0,
            repository: 'demo/public',
            branch: 'main',
            inheritVersion: 1,
          },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send(deliveryPath, 'GET', undefined, owner)).data.data.source,
      'PROJECT',
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/references',
          'POST',
          { version: 1, path: 'README.md', startLine: 1, endLine: 2 },
          owner,
        )
      ).status,
      422,
    );
    let changed = await send(
      deliveryPath + '/references',
      'POST',
      {
        version: 1,
        path: 'README.md',
        startLine: 1,
        endLine: 1,
        note: '验收实现依据',
        criterion: { index: 0, text: '验收A' },
      },
      owner,
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.data.data.references[0].endLine, 1);
    assert.equal(
      (
        await send(
          deliveryPath,
          'PUT',
          { version: 2, repository: 'demo/public', branch: 'next' },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/upstream?path=README.md',
          'GET',
          undefined,
          reader,
        )
      ).data.changed,
      true,
    );
    changed = await send(
      deliveryPath + '/references',
      'POST',
      {
        version: 3,
        path: 'README.md',
        keepSnapshot: true,
        note: '保留原提交',
        startLine: 1,
        endLine: 1,
        criterion: { index: 0, text: '验收A' },
      },
      owner,
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.data.data.references[0].commit, 'a'.repeat(40));
    changed = await send(
      deliveryPath + '/references',
      'POST',
      {
        version: 4,
        path: 'README.md',
        note: '更新到当前提交',
        startLine: 1,
        endLine: 1,
        criterion: { index: 0, text: '验收A' },
      },
      owner,
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.data.data.references[0].commit, 'c'.repeat(40));
    assert.equal(
      (
        await send(
          deliveryPath + '/upstream?path=README.md',
          'GET',
          undefined,
          owner,
        )
      ).data.changed,
      false,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 5, pull: 'https://github.com/other/private/pull/1' },
          owner,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 5, pull: '1' },
          reader,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 5, pull: '1' },
          owner,
        )
      ).status,
      200,
    );
    const pr = (await send(deliveryPath + '/pulls/1', 'GET', undefined, reader))
      .data;
    assert.equal(pr.state, 'merged');
    assert.equal(pr.checks.items[0].conclusion, 'success');
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 6, pull: '2' },
          owner,
        )
      ).status,
      200,
    );
    const partial = (
      await send(deliveryPath + '/pulls/2', 'GET', undefined, reader)
    ).data;
    assert(partial.checks.error);
    assert.equal(partial.statuses.state, 'success');
    assert.equal(
      (await send(deliveryPath + '/pulls/3', 'GET', undefined, reader)).status,
      404,
    );
    const unchanged = await db.task.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    assert.equal(unchanged.status, 'DRAFT');
    assert.equal(unchanged.version, delivery.version);
    await db.task.update({
      where: { id: delivery.id },
      data: {
        data: { ...(unchanged.data as any), criteria: ['全新验收'] },
        version: { increment: 1 },
      },
    });
    assert.equal(
      (
        await send(
          deliveryPath + '/references',
          'POST',
          {
            version: 7,
            path: 'README.md',
            criterion: { index: 0, text: '验收A' },
          },
          owner,
        )
      ).status,
      409,
    );
    assert.equal(
      (await send(projectPath, 'DELETE', { version: 1 }, owner)).status,
      200,
    );
    assert.equal(
      (await send(deliveryPath, 'GET', undefined, owner)).data.data.references
        .length,
      1,
    );
    assert.equal(
      (
        await send(
          projectPath,
          'PUT',
          { version: 2, repository: 'demo/public' },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send(projectPath, 'DELETE', { version: 1 }, owner)).status,
      409,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 7, pull: '3' },
          owner,
        )
      ).status,
      200,
    );
    const large = (
      await send(deliveryPath + '/pulls/3', 'GET', undefined, owner)
    ).data;
    assert.equal(large.checks.incomplete, true);
    assert.equal(large.checks.items.length, 100);
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 8, pull: '3', remove: true },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send(deliveryPath + '/pulls/3', 'GET', undefined, reader)).status,
      404,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 9, pull: '4' },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await send(deliveryPath + '/pulls/4', 'GET', undefined, owner)).data
        .state,
      'closed',
    );
    await db.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });
    assert.equal(
      (await send(projectPath, 'DELETE', { version: 3 }, owner)).status,
      409,
    );
    assert.equal(
      (
        await send(
          deliveryPath + '/pulls',
          'POST',
          { version: 10, pull: '1', remove: true },
          owner,
        )
      ).status,
      409,
    );
    await db.project.update({
      where: { id: project.id },
      data: { archivedAt: null },
    });
  } finally {
    child.kill();
    await db.$disconnect();
  }
});
