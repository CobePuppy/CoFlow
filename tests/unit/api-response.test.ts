import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  readApiResponse,
} from '../../packages/web-core/src/shared/api/api-response.js';

test('接口读取正常 JSON 与无内容响应', async () => {
  assert.deepEqual(await readApiResponse(Response.json({ ok: true })), {
    ok: true,
  });
  assert.equal(
    await readApiResponse(new Response(null, { status: 204 })),
    null,
  );
});

test('网关 HTML、空错误响应仍保留 HTTP 状态和可读提示', async () => {
  for (const body of [
    '<html>private proxy details</html>',
    '',
    'null',
    '"error"',
  ]) {
    await assert.rejects(
      readApiResponse(new Response(body, { status: 502 })),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        assert.match(error.message, /HTTP 502/);
        assert.doesNotMatch(error.message, /private|undefined|Unexpected/);
        return true;
      },
    );
  }
});

test('非 JSON 的未登录响应保留 401，成功但损坏的响应明确报错', async () => {
  await assert.rejects(
    readApiResponse(new Response('expired', { status: 401 })),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );
  for (const body of ['broken', '']) {
    await assert.rejects(
      readApiResponse(new Response(body)),
      /服务器响应格式异常/,
    );
  }
});

test('字段错误继续中文化，版本冲突保留输入提示', async () => {
  await assert.rejects(
    readApiResponse(
      Response.json(
        { fieldErrors: { fieldErrors: { description: ['required'] } } },
        { status: 400 },
      ),
    ),
    /需求描述填写不完整或格式有误/,
  );
  await assert.rejects(
    readApiResponse(Response.json({ message: '版本冲突' }, { status: 409 })),
    /版本冲突（输入已保留，请核对最新状态）/,
  );
});
