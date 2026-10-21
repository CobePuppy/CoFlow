import { taskResourceSummaries } from '../../apps/api/src/modules/documents/resource-summaries.js';
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
test('需求资料引用：权限、个人授权撤销、版本确认、分页、事务回滚与归属保护', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(
    url &&
      new URL(url).pathname === '/coflow_test' &&
      url !== process.env.DATABASE_URL,
  );
  let measured: string[] | null = null;
  const db = new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: 'event', level: 'query' }],
  });
  db.$on('query', (event) => measured?.push(event.query));
  const origin = 'http://localhost:5173',
    base = 'http://127.0.0.1:3107/api/v1';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: '3107',
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
  async function upload(route: string, a: any, name = '规范.md') {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['# 规范\n验证后交付'], { type: 'text/markdown' }),
      name,
    );
    const r = await send(route, 'POST', form, a);
    assert([200, 201].includes(r.status), JSON.stringify(r));
    return r.data;
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
    const version = async () =>
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).version;
    const resource = '/tasks/' + t.id + '/resources';
    const link = async (
      f: any,
      kind = 'FILE',
      sharePersonal = false,
      who = a,
    ) =>
      send(
        resource,
        'POST',
        {
          expectedVersion: await version(),
          kind,
          sourceId: f.id,
          sourceVersion: f.version || 1,
          sharePersonal,
        },
        who,
      );
    const personal = await upload('/me/files', a),
      other = await upload('/me/files', b),
      team = await upload('/workspaces/' + a.workspaceId + '/files', a),
      foreign = await upload('/workspaces/' + c.workspaceId + '/files', c);
    const old = await version();
    assert.equal((await link(personal)).status, 422);
    assert.equal(await version(), old);
    assert.equal((await link(other, 'FILE', true)).status, 404);
    assert.equal((await link(foreign)).status, 404);
    const personalRef = await link(personal, 'FILE', true);
    assert.equal(personalRef.status, 201, JSON.stringify(personalRef));
    const pr = personalRef.data.id;
    assert.equal(
      (await send(resource + '/' + pr + '/download', 'GET', undefined, b))
        .status,
      200,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + personal.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
    assert.equal((await send(resource, 'GET', undefined, c)).status, 404);
    assert.equal(
      (
        await send(
          resource + '/' + pr,
          'DELETE',
          { expectedVersion: await version() },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          '/space-files/' + personal.id + '/references',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
    const teamRef = await link(team);
    assert.equal(teamRef.status, 201);
    assert.equal((await link(team)).status, 409);
    await send(
      '/space-files/' + team.id,
      'PATCH',
      { expectedVersion: 1, name: '规范新版.md' },
      a,
    );
    let list = await send(resource, 'GET', undefined, b);
    const item = list.data.find((r: any) => r.id === teamRef.data.id);
    assert.equal(item.status, 'UPDATED');
    assert.equal(item.sourceVersion, 1);
    assert.equal(item.currentVersion, 2);
    assert.equal(list.headers.get('cache-control'), 'private, no-store');
    assert(!JSON.stringify(list.data).includes('sf-'));
    assert.equal(
      (
        await send(
          resource + '/' + teamRef.data.id + '/refresh',
          'POST',
          { expectedVersion: await version(), sourceVersion: 1 },
          a,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          resource + '/' + teamRef.data.id + '/refresh',
          'POST',
          { expectedVersion: await version(), sourceVersion: 2 },
          a,
        )
      ).status,
      204,
    );
    await send('/space-files/' + team.id, 'DELETE', { expectedVersion: 2 }, a);
    list = await send(resource, 'GET', undefined, b);
    assert.equal(
      list.data.find((r: any) => r.id === teamRef.data.id).status,
      'UNAVAILABLE',
    );
    assert.equal(
      (
        await send(
          resource + '/' + teamRef.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
    const doc = (
      await send(
        '/projects/' + p.id + '/documents',
        'POST',
        { title: '项目规范文档', content: '规范内容', taskIds: [] },
        a,
      )
    ).data;
    assert.equal((await link(doc, 'DOCUMENT')).status, 201);
    assert(
      (
        await send('/documents/' + doc.id + '/tasks', 'GET', undefined, b)
      ).data.some((x: any) => x.id === t.id),
    );
    assert.equal(
      (await send(resource + '/candidates?scope=DOCUMENT', 'GET', undefined, a))
        .status,
      200,
    );
    const docUpdate = await send(
      '/documents/' + doc.id,
      'PATCH',
      {
        expectedVersion: 1,
        title: '更新后的项目规范',
        content: '规范正文已修改',
        taskIds: [],
      },
      a,
    );
    assert.equal(docUpdate.status, 200);
    const docItem = (await send(resource, 'GET', undefined, b)).data.find(
      (r: any) => r.kind === 'DOCUMENT',
    );
    assert.equal(docItem.status, 'UPDATED');
    assert.equal(docItem.currentVersion, 2);
    const attach = await upload('/projects/' + p.id + '/attachments', a);
    assert.equal((await link(attach, 'ATTACHMENT')).status, 201);
    for (let i = 0; i < 11; i++)
      await upload(
        '/workspaces/' + a.workspaceId + '/files',
        a,
        '分页-' + i + '.md',
      );
    const candidates = await send(
      resource + '/candidates?scope=TEAM&page=2&pageSize=10',
      'GET',
      undefined,
      a,
    );
    assert.equal(candidates.status, 200);
    assert.equal(candidates.data.total, 11);
    assert.equal(candidates.data.items.length, 1);
    // Build an isolated large reference set, then measure the actual PostgreSQL reads.
    const parent = (
      await send(
        '/projects/' + p.id + '/tasks',
        'POST',
        { title: '附件来源需求', productId: a.user.id, engineerId: a.user.id },
        a,
      )
    ).data;
    const parentFile = await upload(
      '/tasks/' + parent.id + '/attachments',
      a,
      '需求内附件.md',
    );
    const parentRef = await link(parentFile, 'ATTACHMENT');
    assert.equal(parentRef.status, 201);
    const documents = Array.from({ length: 80 }, (_, i) => ({
      id: randomUUID(),
      workspaceId: a.workspaceId,
      projectId: p.id,
      title: '批量规范' + i,
      content: '只读取摘要不读取正文'.repeat(500),
      taskIds: [],
      version: 1,
      revisions: [],
    }));
    await db.document.createMany({ data: documents });
    await db.taskResource.createMany({
      data: documents.map((d) => ({
        id: randomUUID(),
        taskId: t.id,
        kind: 'DOCUMENT',
        sourceId: d.id,
        sourceVersion: 1,
        title: d.title,
        sourceScope: 'PROJECT',
        personalShared: false,
        createdBy: a.user.id,
        taskTitle: t.data.title,
      })),
    });
    const before = await send(resource, 'GET', undefined, b);
    assert.equal(before.status, 200);
    assert(before.data.every((ref: any) => ref.canManage === false));
    assert(
      (await send(resource, 'GET', undefined, a)).data.every(
        (ref: any) => ref.canManage === true,
      ),
    );
    await db.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: a.workspaceId, userId: b.user.id },
      },
      data: { role: 'ADMIN' },
    });
    assert(
      (await send(resource, 'GET', undefined, b)).data.every(
        (ref: any) => ref.canManage === true,
      ),
    );
    await db.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: a.workspaceId, userId: b.user.id },
      },
      data: { role: 'MEMBER' },
    });
    const currentTask = await db.task.findUniqueOrThrow({
      where: { id: t.id },
    });
    measured = [];
    const batch = await db.$transaction(
      (tx) => taskResourceSummaries(tx, currentTask, b.user.id),
      { isolationLevel: 'RepeatableRead' },
    );
    const statements: string[] = measured;
    measured = null;
    const reads = statements.filter((sql) => /^SELECT\b/.test(sql));
    assert.equal(reads.length, 6, '不应按引用条数增加查询');
    assert(
      !reads.some((sql) => /\."(content|revisions|data|key)"/.test(sql)),
      '摘要禁止读取正文、修订、任务历史和存储键',
    );
    assert(batch.length >= 80);
    assert.deepEqual(JSON.parse(JSON.stringify(batch)), before.data);
    console.log(
      '资料摘要真实数据库：' +
        batch.length +
        '条引用，' +
        reads.length +
        '条SELECT，结果与HTTP一致',
    );
    await db.task.update({
      where: { id: parent.id },
      data: { deletedAt: new Date(), deletedBy: a.user.id },
    });
    const parentUnavailable = (
      await send(resource, 'GET', undefined, b)
    ).data.find((ref: any) => ref.id === parentRef.data.id);
    assert.equal(parentUnavailable.status, 'UNAVAILABLE');
    assert.equal(parentUnavailable.currentTitle, null);
    assert.equal(
      (
        await send(
          resource + '/' + parentRef.data.id + '/download',
          'GET',
          undefined,
          b,
        )
      ).status,
      404,
    );
    const target = (
      await send(
        '/workspaces/' + a.workspaceId + '/projects',
        'POST',
        { name: '其他项目', workflow: 'SIMPLE' },
        a,
      )
    ).data;
    await send(
      '/projects/' + target.id + '/members',
      'POST',
      { userId: a.user.id, roles: ['PRODUCT', 'ENGINEER'] },
      a,
    );
    assert.equal(
      (
        await send(
          '/tasks/' + t.id,
          'PATCH',
          {
            expectedVersion: await version(),
            projectId: target.id,
            engineerId: a.user.id,
          },
          a,
        )
      ).status,
      409,
    );
    const concurrent = [
      await upload('/workspaces/' + a.workspaceId + '/files', a, '并发1.md'),
      await upload('/workspaces/' + a.workspaceId + '/files', a, '并发2.md'),
    ];
    const concurrentVersion = await version();
    const outcomes = await Promise.all(
      concurrent.map((file) =>
        send(
          resource,
          'POST',
          {
            expectedVersion: concurrentVersion,
            kind: 'FILE',
            sourceId: file.id,
            sourceVersion: file.version,
          },
          a,
        ),
      ),
    );
    assert.deepEqual(outcomes.map((x) => x.status).sort(), [201, 409]);
    assert.equal(await version(), concurrentVersion + 1);
    const audit = 'reject_resource_audit_' + Date.now();
    await db.$executeRawUnsafe(
      'CREATE FUNCTION ' +
        audit +
        "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='TASK_RESOURCE_LINK' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER ' +
        audit +
        ' BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ' +
        audit +
        '()',
    );
    const extra = await upload('/me/files', a, '事务.md');
    const v = await version();
    try {
      assert.equal((await link(extra, 'FILE', true)).status, 500);
      assert.equal(await version(), v);
      assert.equal(
        await db.taskResource.count({ where: { sourceId: extra.id } }),
        0,
      );
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER ' + audit + ' ON "AuditEvent"');
      await db.$executeRawUnsafe('DROP FUNCTION ' + audit + '()');
    }
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: new Date() },
    });
    assert.equal((await link(personal, 'FILE', true)).status, 409);
    await db.project.update({
      where: { id: p.id },
      data: { archivedAt: null },
    });
    await db.projectMember.delete({
      where: { projectId_userId: { projectId: p.id, userId: a.user.id } },
    });
    assert.equal(
      (
        await send(
          '/space-files/' + personal.id + '/references/' + pr,
          'DELETE',
          undefined,
          a,
        )
      ).status,
      204,
    );
    assert.equal(
      (await send(resource + '/' + pr + '/download', 'GET', undefined, b))
        .status,
      404,
    );
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: a.workspaceId, userId: b.user.id },
      },
    });
    assert.equal((await send(resource, 'GET', undefined, b)).status, 404);
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once('exit', () => r()));
    await db.$disconnect();
  }
});
