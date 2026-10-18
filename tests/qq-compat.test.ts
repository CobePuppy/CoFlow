import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('QQ-Agent 兼容补丁在 preview/preview2 上通过语法校验且可重复执行', async () => {
  const { compatibilityPlan } = await import(
    pathToFileURL(path.resolve('integrations/qq-agent/compat.mjs')).href
  );
  for (const version of ['QQ-Agent 0.4 preview', 'QQ-Agent 0.4 preview2']) {
    const source = path.join('D:/SrcCode/QQ-Agent', version);
    try {
      await fs.access(source);
    } catch {
      continue;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coflow-compat-'));
    try {
      await fs.mkdir(path.join(dir, 'src/skills'), { recursive: true });
      for (const name of ['src/app.js', 'src/skills/manager.js'])
        await fs.copyFile(path.join(source, name), path.join(dir, name));
      const changes = compatibilityPlan(dir);
      assert.equal(changes.length, version.endsWith('preview2') ? 2 : 0);
      for (const change of changes)
        await fs.writeFile(change.file, change.content);
      assert.deepEqual(compatibilityPlan(dir), []);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});
