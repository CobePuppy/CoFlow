import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root = process.cwd(), require = createRequire(path.join(root, 'package.json'));
const out = path.resolve('artifacts/coflow-qq-integration');
if (fs.existsSync(out)) throw new Error('输出目录已存在，请指定新的产物目录或移走已有产物');
fs.mkdirSync(out, { recursive: true });
const bridge = path.resolve('integrations/qq-agent');
for (const name of ['install.mjs', 'compat.mjs', 'verify.mjs', 'Install-CoFlowQQ.ps1', 'Verify-CoFlowQQ.ps1', 'Rollback-CoFlowQQ.ps1', 'README.md', 'VALIDATION.md', 'coflow']) fs.cpSync(path.join(bridge, name), path.join(out, name), { recursive: true });
const prisma = path.dirname(require.resolve('.prisma/client/package.json', { paths: [path.dirname(require.resolve('@prisma/client'))] }));
for (const [source, target] of [['apps/api/dist', 'apps/api/dist'], ['apps/web/dist', 'apps/web/dist'], ['prisma', 'prisma'], [prisma, 'node_modules/.prisma/client']]) fs.cpSync(path.resolve(source), path.join(out, 'payload', target), { recursive: true });
const manifest = {};
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else manifest[path.relative(path.join(out, 'payload'), file).replaceAll('\\', '/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
}
walk(path.join(out, 'payload'));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`部署目录：${out}；${Object.keys(manifest).length} 个已校验文件。不包含密钥、数据库或 QQ 会话数据。`);
