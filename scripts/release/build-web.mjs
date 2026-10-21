import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const distribution = path.join(root, 'apps/web/dist');
const archive = path.resolve(root, 'artifacts', 'web-before-' + Date.now());
for (const value of [distribution, archive]) {
  const relative = path.relative(root, value);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Build path outside workspace');
}
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
if (fs.existsSync(distribution)) fs.renameSync(distribution, archive);
for (const edition of ['enterprise', 'student']) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'apps/web/node_modules/vite/bin/vite.js'),
      'build',
      path.join(root, `apps/${edition}-web`),
    ],
    { stdio: 'inherit', cwd: root },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  const from = path.join(root, `apps/${edition}-web/dist`),
    to = path.join(root, `apps/web/dist/${edition}`);
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}
fs.copyFileSync(
  path.join(root, 'apps/web/dist/enterprise/index.html'),
  path.join(root, 'apps/web/dist/index.html'),
);
// Preserve stable brand URLs used in invitations, login and both applications.
fs.cpSync(
  path.join(root, 'apps/web/public'),
  path.join(root, 'apps/web/dist'),
  { recursive: true },
);
