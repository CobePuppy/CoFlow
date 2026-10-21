import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const out = path.resolve(
  process.argv[2] || `artifacts/CoFlow-v${version.product}`,
);
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
const esbuildCli = require.resolve('esbuild/bin/esbuild', {
  paths: [path.resolve('apps/api')],
});
const verifier = path.join(out, 'proof-verifier.js');
const compiled = spawnSync(
  process.execPath,
  [
    esbuildCli,
    'scripts/maintenance/verify-proof.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--outfile=' + verifier,
  ],
  { stdio: 'inherit' },
);
if (compiled.status !== 0) throw new Error('Proof verifier build failed');
for (const [source, target] of [
  ['apps/api/dist', 'apps/api/dist'],
  ['apps/web/dist', 'apps/web/dist'],
  ['prisma/migrations', 'prisma/migrations'],
  ['prisma/schema.prisma', 'prisma/schema.prisma'],
  [path.join(clientBuild, 'client'), 'node_modules/.prisma/client'],
  ['version.json', 'version.json'],
  ['CHANGELOG.md', 'CHANGELOG.md'],
  [verifier, 'scripts/verify-proof.js'],
])
  fs.cpSync(source, path.join(payload, target), { recursive: true });
// Ship the matching maintenance tools with the API so independent file spaces
// participate in backups and orphan detection on installations without tsx.
for (const name of ['backup', 'storage-cleanup']) {
  const output = path.join(payload, 'apps/api/dist/maintenance', name + '.js');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      esbuildCli,
      `scripts/maintenance/${name}.ts`,
      '--bundle',
      '--packages=external',
      '--platform=node',
      '--format=esm',
      '--outfile=' + output,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(name + ' maintenance build failed');
}
const migrations = fs
  .readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const meta = {
  version,
  id:
    version.product.replaceAll('.', '-') +
    '-platform-' +
    digest(
      Buffer.concat([
        fs.readFileSync('apps/api/dist/main.js'),
        fs.readFileSync('apps/web/dist/enterprise/index.html'),
        fs.readFileSync('apps/web/dist/student/index.html'),
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
