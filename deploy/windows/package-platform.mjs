import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const out = path.resolve(process.argv[2] || 'artifacts/platform-20261017');
if (fs.existsSync(out))
  throw new Error('Release output already exists: ' + out);
fs.mkdirSync(path.join(out, 'payload'), { recursive: true });
const payload = path.join(out, 'payload');
// Build from the current schema without overwriting a running client's locked engine.
const clientBuild = path.join(out, 'prisma-client-build');
fs.mkdirSync(clientBuild, { recursive: true });
const schemaPath = path.join(clientBuild, 'schema.prisma');
fs.writeFileSync(
  schemaPath,
  fs
    .readFileSync('prisma/schema.prisma', 'utf8')
    .replace(
      /generator client\s*\{/,
      'generator client {\n  output = "./client"',
    ),
);
const require = createRequire(import.meta.url);
const prismaCli = path.join(
  path.dirname(require.resolve('prisma/package.json')),
  'build/index.js',
);
const generated = spawnSync(
  process.execPath,
  [prismaCli, 'generate', '--schema', schemaPath],
  { stdio: 'inherit' },
);
if (generated.error) throw generated.error;
if (generated.status !== 0) throw new Error('Prisma client generation failed');
for (const [source, target] of [
  ['apps/api/dist', 'apps/api/dist'],
  ['apps/web/dist', 'apps/web/dist'],
  ['prisma/migrations', 'prisma/migrations'],
  ['prisma/schema.prisma', 'prisma/schema.prisma'],
  [path.join(clientBuild, 'client'), 'node_modules/.prisma/client'],
  ['artifacts/release-20261017-verify-proof.js', 'scripts/verify-proof.js'],
])
  fs.cpSync(source, path.join(payload, target), { recursive: true });
const migrations = fs
  .readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const meta = {
  id:
    '20261017-platform-' +
    digest(
      Buffer.concat([
        fs.readFileSync('apps/api/dist/main.js'),
        fs.readFileSync('apps/web/dist/index.html'),
      ]),
    ).slice(0, 8),
  builtAt: new Date().toISOString(),
  migrations,
};
fs.writeFileSync(
  path.join(payload, 'apps/web/dist/release.json'),
  JSON.stringify(meta, null, 2),
);
const files = {};
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else
      files[path.relative(payload, file).replaceAll('\\', '/')] = digest(
        fs.readFileSync(file),
      );
  }
}
walk(payload);
fs.writeFileSync(
  path.join(out, 'manifest.json'),
  JSON.stringify(
    { format: 'coflow-platform-release/v1', ...meta, files },
    null,
    2,
  ),
);
fs.copyFileSync(
  'deploy/windows/platform-update.mjs',
  path.join(out, 'platform-update.mjs'),
);
fs.copyFileSync(
  'deploy/windows/Apply-PlatformRelease.ps1',
  path.join(out, 'Apply-CoFlowUpdate.ps1'),
);
fs.copyFileSync(
  'deploy/windows/Update-Platform.cmd',
  path.join(out, 'Update-Platform.cmd'),
);
const qq = path.join(out, 'qq-package');
fs.mkdirSync(qq, { recursive: true });
for (const name of [
  'install.mjs',
  'compat.mjs',
  'verify.mjs',
  'Install-CoFlowQQ.ps1',
  'Verify-CoFlowQQ.ps1',
  'Rollback-CoFlowQQ.ps1',
  'README.md',
  'coflow',
])
  fs.cpSync(path.join('integrations/qq-agent', name), path.join(qq, name), {
    recursive: true,
  });
// QQ installer accepts only its own payload roots; the proof verifier is distributed with the platform.
const qqFiles = {};
for (const [relative, checksum] of Object.entries(files)) {
  if (!/^(apps\/|prisma\/|node_modules\/)/.test(relative)) continue;
  const target = path.join(qq, 'payload', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(payload, relative), target);
  qqFiles[relative] = checksum;
}
fs.writeFileSync(
  path.join(qq, 'manifest.json'),
  JSON.stringify(qqFiles, null, 2),
);
console.log(
  JSON.stringify({
    directory: out,
    id: meta.id,
    files: Object.keys(files).length,
    migrations: migrations.length,
  }),
);
