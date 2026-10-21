import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const url = process.env.TEST_DATABASE_URL;
assert(
  url &&
    new URL(url).pathname === '/coflow_test' &&
    url !== process.env.DATABASE_URL,
  'Only isolated coflow_test is allowed',
);
const api = fs.readFileSync('apps/api/dist/main.js', 'utf8');
assert(!/from\s*["']@coflow\/contracts/.test(api), 'API must bundle contracts');
const enterprise = fs.readdirSync('apps/web/dist/enterprise/assets');
assert(
  !enterprise.some((name) =>
    /^(Competitions|StudentWriting|FirstStepAgent)-/.test(name),
  ),
  'Student pages leaked into enterprise build',
);
const origin = 'http://127.0.0.1:3110';
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: {
    ...process.env,
    DATABASE_URL: url,
    PORT: '3110',
    APP_ORIGIN: origin,
    SERVE_WEB: 'true',
    SETTINGS_ENCRYPTION_KEY: '1'.repeat(64),
    STORAGE_DIR: './storage-test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '';
child.stderr.on('data', (data) => {
  errors += data.toString();
});
child.stdout.resume();
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin + '/api/v1/health')).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(ready, 'Compiled API did not start: ' + errors);
  for (const [path, edition] of [
    ['/', 'enterprise'],
    ['/enterprise/', 'enterprise'],
    ['/student/', 'student'],
    ['/student/deep-link?task=example', 'student'],
    ['/?task=legacy', 'enterprise'],
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const assets = [
      ...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g),
    ].map((match) => match[1]);
    assert(assets.length, path + ' has no assets');
    for (const asset of assets) {
      assert(asset.startsWith('/' + edition + '/assets/'), asset);
      const resource = await fetch(origin + asset);
      assert.equal(resource.status, 200, asset);
      assert(
        !resource.headers.get('content-type')?.includes('text/html'),
        asset,
      );
    }
  }
  assert.equal(
    (await fetch(origin + '/student/assets/missing.js')).status,
    404,
  );
  console.log(
    'Compiled API health, both SPA entries/deep links/assets, missing resources and enterprise isolation passed.',
  );
} finally {
  child.kill();
}
