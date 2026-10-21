import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

test('QQ 插件：真实 HTTP 查询、群聊隐私、去重、失败重试和禁用', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coflow-qq-test-'));
  const source = (
    await fs.readFile('integrations/qq-agent/coflow/index.js', 'utf8')
  ).replace(
    "import { DATA_DIR } from '../../src/config.js';",
    `const DATA_DIR = ${JSON.stringify(dir)};`,
  );
  const load = async (suffix: string) =>
    import(
      `data:text/javascript;base64,${Buffer.from(source + `\n// ${suffix}`).toString('base64')}`
    );
  let hold: (() => void) | undefined;
  let delayed = false;
  let workCalls = 0;
  let policyCalls = 0;
  const data = {
    total: 1,
    page: 1,
    pageSize: 8,
    items: [
      {
        number: 1,
        title: '仅本人可见 [CQ:at,qq=all]',
        project: '测试项目',
        status: '开发中',
        priority: 'P1',
        dueAt: null,
        url: 'https://example.com/?task=t',
      },
    ],
  };
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + 'a'.repeat(64));
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/policy')) {
      policyCalls++;
      assert.equal(req.headers['x-coflow-workspace'], 'test-workspace');
      res.end(JSON.stringify({ pushEnabled: true, pushTimes: '09:00' }));
      return;
    }
    const send = () =>
      res.end(
        JSON.stringify(
          req.url?.includes('/recipients')
            ? { items: [{ qq: '123456789' }], nextCursor: null }
            : data,
        ),
      );
    if (req.url?.includes('/work')) {
      workCalls++;
      if (delayed) {
        hold = send;
        return;
      }
    }
    send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  let config: any = {
    apiBase: `http://127.0.0.1:${port}/api/v1/integrations/qq`,
    accessToken: 'a'.repeat(64),
    pushEnabled: true,
    pushTimes: '09:00,18:00',
  };
  const sent: { target: string; body: string }[] = [];
  let fail = false;
  const sender = {
    async sendTextBatch(target: string, body: string[]) {
      if (fail) throw new Error('offline');
      sent.push({ target, body: body.join('\n') });
    },
  };
  const setup = (plugin: any) => {
    plugin.setup({ config: () => config, warn() {} });
    plugin.activate();
  };
  const now = Date.parse('2026-10-16T01:00:00Z');
  try {
    let plugin = await load('one');
    setup(plugin);
    assert.throws(() =>
      plugin.endpoint(
        { ...config, apiBase: 'http://10.0.0.1/api/v1/integrations/qq' },
        'work',
      ),
    );
    assert.equal(plugin.slotKey(now, config.pushTimes), '2026-10-16T09:00');
    assert.equal(plugin.slotKey(now + 60000, config.pushTimes), null);
    const ctx = {
      kind: 'group',
      chatId: '987654321',
      senderId: '123456789',
      text: '/工作',
      sender,
    };
    await plugin.providers['message.command'](ctx).done;
    assert.equal(sent[0].target, 'private:123456789');
    assert(sent[0].body.includes('仅本人可见'), sent[0].body);
    assert(!sent[0].body.includes('[CQ:'));
    assert.equal(sent[1].target, 'group:987654321');
    assert(!sent[1].body.includes('仅本人可见'));
    const before = workCalls;
    await plugin.providers['message.command']({
      ...ctx,
      text: '/工作 绑定 ' + 'b'.repeat(32),
    }).done;
    assert.equal(workCalls, before);
    sent.length = 0;
    await Promise.all([
      plugin.providers['schedule.tick']({ sender, now }),
      plugin.providers['schedule.tick']({ sender, now }),
    ]);
    assert.equal(sent.length, 1);
    await plugin.providers['schedule.tick']({ sender, now });
    assert.equal(sent.length, 1);
    plugin.deactivate();
    plugin = await load('reload');
    setup(plugin);
    await plugin.providers['schedule.tick']({ sender, now });
    assert.equal(sent.length, 1);
    fail = true;
    await plugin.providers['schedule.tick']({ sender, now: now + 9 * 3600000 });
    fail = false;
    await plugin.providers['schedule.tick']({ sender, now: now + 9 * 3600000 });
    assert.equal(sent.length, 2);
    await plugin.providers['schedule.tick']({ sender, now: now + 9 * 3600000 });
    assert.equal(sent.length, 2);
    delayed = true;
    const pending = plugin.providers['message.command']({
      ...ctx,
      kind: 'private',
    }).done;
    for (let i = 0; !hold && i < 100; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert(hold);
    plugin.deactivate();
    hold();
    await pending;
    assert.equal(sent.length, 2);
    setup(plugin);
    config = { ...config, pushEnabled: false };
    await plugin.providers['schedule.tick']({ sender, now: now + 86400000 });
    assert.equal(sent.length, 2);
    config = { ...config, pushEnabled: true };
    delayed = false;
    await fs.writeFile(path.join(dir, 'plugins/coflow/reminders.json'), '[]');
    await plugin.providers['schedule.tick']({ sender, now: now + 86400000 });
    assert.equal(
      sent.length,
      2,
      '损坏的提醒记录必须停止推送，避免丢失去重状态',
    );
    plugin.dispose();
    await fs.writeFile(path.join(dir, 'plugins/coflow/reminders.json'), '{}');
    plugin = await load('policy');
    config = {
      ...config,
      workspaceId: 'test-workspace',
      syncPolicy: true,
      pushEnabled: true,
      pushTimes: '00:00',
    };
    setup(plugin);
    await plugin.providers['schedule.tick']({
      sender,
      now: now + 2 * 86400000,
    });
    assert.equal(policyCalls, 1);
    assert.equal(sent.length, 3);
    await plugin.providers['schedule.tick']({
      sender,
      now: now + 2 * 86400000,
    });
    assert.equal(policyCalls, 1);
    assert.equal(sent.length, 3);
    plugin.dispose();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
