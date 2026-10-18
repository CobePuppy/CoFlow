import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compatibilityPlan } from './compat.mjs';
import { createInterface } from 'node:readline/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf('--' + name); return i < 0 ? '' : args[i + 1]; };
function inside(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('部署路径越界');
}
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.coflow-tmp', content, { mode: 0o600 });
  fs.renameSync(file + '.coflow-tmp', file);
}
async function main() {
  if (!arg('coflow') || !arg('agent')) throw new Error('需要 --coflow 和 --agent 绝对路径');
  const root = fs.realpathSync(arg('coflow')), agentRoot = fs.realpathSync(arg('agent'));
  const agentApp = fs.existsSync(path.join(agentRoot, 'resources/app/src/app.js')) ? path.join(agentRoot, 'resources/app') : agentRoot;
  const configSource = fs.readFileSync(path.join(agentApp, 'src/config.js'), 'utf8');
  if (!configSource.includes('export const DATA_DIR')) throw new Error('无法识别 QQ-Agent 数据目录');
  const dataName = `data${process.env.QQ_AGENT_PROFILE && process.env.QQ_AGENT_PROFILE !== '1' ? '-' + process.env.QQ_AGENT_PROFILE : ''}`;
  const portableData = path.join(agentRoot, dataName);
  const defaultData = fs.existsSync(path.join(portableData, 'config.json')) ? portableData : path.join(agentApp, dataName);
  const dataDir = path.resolve(arg('data') || process.env.QQ_AGENT_DATA_DIR || defaultData);
  const configFile = path.join(dataDir, 'config.json');
  if (!fs.existsSync(configFile)) throw new Error('未找到 QQ-Agent config.json。先启动一次程序，或用 --data 指定实际数据目录。');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const require = createRequire(path.join(root, 'package.json'));
  const dotenv = require('dotenv');
  const envFile = path.join(root, '.env'), originalEnv = fs.readFileSync(envFile, 'utf8'), env = dotenv.parse(originalEnv);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  let teams;
  try {
    try { await db.$connect(); }
    catch (e) {
      const address = new URL(env.DATABASE_URL);
      const pgCtl = path.join(root, 'runtime/postgres/bin/pg_ctl.exe');
      const pgData = path.join(root, '.data/postgres');
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname);
      if (e.errorCode !== 'P1001' || !local || !fs.existsSync(pgCtl) || !fs.existsSync(path.join(pgData, 'PG_VERSION'))) throw e;
      if (args.includes('--verify-only')) throw new Error('PostgreSQL is stopped. Run the normal installer to start the existing bundled database; verification-only does not start it.');
      console.log('Starting the existing CoFlow PostgreSQL database (website remains stopped).');
      const status = spawnSync(pgCtl, ['-D', pgData, 'status'], { cwd: root, stdio: 'ignore' });
      if (status.status === 0) throw new Error('Bundled PostgreSQL is running but the configured database address is unreachable. Inspect .data/postgres.log and the database port configuration.');
      const started = spawnSync(pgCtl, ['-D', pgData, '-l', path.join(root, '.data/postgres.log'), '-w', '-t', '30', 'start'], { cwd: root, stdio: 'inherit', windowsHide: true });
      if (started.status !== 0) throw new Error('Cannot start the existing PostgreSQL database. Inspect .data/postgres.log. No database was initialized or replaced.');
      await db.$connect();
    }
    teams = await db.workspace.findMany({ select: { id: true, name: true } });
  } finally { await db.$disconnect(); }
  let workspaceId = arg('workspace') || env.QQ_BOT_WORKSPACE_ID || (teams.length === 1 ? teams[0].id : '');
  if (!workspaceId && teams.length > 1 && args.includes('--interactive') && !args.includes('--verify-only')) {
    console.log('Choose the CoFlow team to connect:');
    teams.forEach((team, i) => console.log(`  ${i + 1}. ${team.name} (${team.id})`));
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try {
      while (!workspaceId) {
        const answer = (await input.question(`Team number (1-${teams.length}, q to cancel): `)).trim();
        if (answer.toLowerCase() === 'q') throw new Error('Installation cancelled. Application files and configuration were not changed.');
        const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
        if (Number.isSafeInteger(index) && index >= 0 && index < teams.length) workspaceId = teams[index].id;
        else console.log('Invalid team number. Please enter a number from the list.');
      }
    } finally { input.close(); }
  }
  if (!workspaceId || !teams.some(t => t.id === workspaceId)) {
    console.log('可用团队：', teams);
    throw new Error('多个团队时必须用 --workspace 指定接入的团队 ID');
  }
  let storedIntegration;
  if(typeof db.$queryRawUnsafe==='function') {
    try {
      const tables=await db.$queryRawUnsafe('SELECT to_regclass($1::text)::text AS present','"QQIntegration"');
      if(tables[0]?.present)storedIntegration=(await db.$queryRawUnsafe('SELECT "tokenHash", "webUrl" FROM "QQIntegration" WHERE "workspaceId" = $1',workspaceId))[0];
    }finally{await db.$disconnect();}
  }
  const webUrl = arg('web-url') || storedIntegration?.webUrl || env.QQ_BOT_WEB_URL || env.APP_ORIGIN;
  const link = new URL(webUrl);
  if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password) throw new Error('平台地址无效');
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CoFlow PORT 无效');
  const candidates=[config.skills?.coflow?.accessToken,env.QQ_BOT_TOKEN].filter(t=>typeof t==='string'&&t.length>=32);
  const matched=storedIntegration?.tokenHash?candidates.find(t=>createHash('sha256').update(t).digest('hex')===storedIntegration.tokenHash):null;
  if(storedIntegration?.tokenHash&&!matched)throw new Error('团队已在网页保存机器人令牌，但本机插件和环境变量均不匹配。请先将同一令牌更新到QQ-Agent配置，或在网页重新设置令牌后再安装；不会覆盖已保存凭据。');
  const token=matched||(env.QQ_BOT_TOKEN?.length>=32?env.QQ_BOT_TOKEN:randomBytes(32).toString('hex'));
  const apiBase = `http://127.0.0.1:${port}/api/v1/integrations/qq`;
  const coreChanges = compatibilityPlan(agentApp);
  const payload = path.join(here, 'payload');
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  const changes = [];
  for (const [relative, checksum] of Object.entries(manifest)) {
    if (!/^(apps\/(api|web)\/dist\/|prisma\/|node_modules\/\.prisma\/client\/)/.test(relative)) throw new Error('未知更新文件');
    const source = path.resolve(payload, relative), target = path.resolve(root, relative);
    inside(payload, source); inside(root, target);
    const content = fs.readFileSync(source);
    if (createHash('sha256').update(content).digest('hex') !== checksum) throw new Error('更新文件校验失败：' + relative);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) changes.push({ file: target, content });
  }
  changes.push(...coreChanges);
  for (const name of ['index.js', 'plugin.json']) changes.push({ file: path.join(agentApp, 'plugins/coflow', name), content: fs.readFileSync(path.join(here, 'coflow', name)) });
  let updatedEnv = originalEnv;
  for (const [key, value] of Object.entries({ QQ_BOT_TOKEN: token, QQ_BOT_WORKSPACE_ID: workspaceId, QQ_BOT_WEB_URL: webUrl })) {
    const line = `${key}=${JSON.stringify(value)}`;
    updatedEnv = new RegExp(`^${key}=.*$`, 'm').test(updatedEnv) ? updatedEnv.replace(new RegExp(`^${key}=.*$`, 'm'), () => line) : updatedEnv + '\n' + line + '\n';
  }
  config.skills ||= {};
  config.skills.coflow = { ...(config.skills.coflow || {}), enabled: true, apiBase, workspaceId, syncPolicy: true, accessToken: token, pushEnabled: true, pushTimes: config.skills.coflow?.pushTimes || '09:00,18:00' };
  changes.push({ file: envFile, content: updatedEnv }, { file: configFile, content: JSON.stringify(config, null, 2) });
  if (args.includes('--verify-only')) {
    console.log(`预检通过：${teams.find(t => t.id === workspaceId).name}；${changes.length} 个文件；QQ-Agent 兼容更新 ${coreChanges.length} 个文件。未写入。`); return;
  }
  for (const url of [`http://127.0.0.1:${port}/api/v1/health`, `http://127.0.0.1:${Number(config.server?.port || 3210)}/api/skills`]) {
    let reachable = false;
    try { await fetch(url, { signal: AbortSignal.timeout(1500) }); reachable = true; } catch {}
    if (reachable) throw new Error('安装前必须停止 CoFlow API 并完全退出 QQ Agent，避免运行中覆盖代码与配置');
  }
  const backup = path.join(root, 'backups', 'qq-integration-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backup, { recursive: true });
  console.log('备份目录：' + backup);
  const restore = [];
  try {
    for (const [i, change] of changes.entries()) {
      const existed = fs.existsSync(change.file), copy = path.join(backup, String(i));
      if (existed) fs.copyFileSync(change.file, copy);
      restore.push({ target: change.file, backup: existed ? copy : null });
    }
    fs.writeFileSync(path.join(backup, 'restore.json'), JSON.stringify(restore, null, 2));
    for (const change of changes) atomic(change.file, change.content);
    const migration = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'prisma/schema.prisma')], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
    if (migration.status !== 0) throw new Error('数据库迁移失败');
    const verifyDb = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url: env.DATABASE_URL } } });
    try { await verifyDb.$queryRaw`SELECT count(*) FROM "QQBinding"`; await verifyDb.$queryRaw`SELECT count(*) FROM "QQBindingCode"`; } finally { await verifyDb.$disconnect(); }
    console.log('安装完成。启动 CoFlow 和 QQ Agent，然后运行 Verify-CoFlowQQ.ps1 验证接口与插件状态；真实私信需本人绑定后验证。');
  } catch (e) {
    for (const entry of restore.reverse()) {
      if (entry.backup) atomic(entry.target, fs.readFileSync(entry.backup));
      else if (fs.existsSync(entry.target)) fs.unlinkSync(entry.target);
    }
    throw new Error(`${e.message}。文件已恢复；已成功执行的附加数据库迁移保留。`);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
