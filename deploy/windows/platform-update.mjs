import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const arg = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? '' : process.argv[i + 1]; };
const allowed = /^(apps\/(api|web)\/dist\/|prisma\/(schema\.prisma|migrations\/)|node_modules\/\.prisma\/client\/|scripts\/verify-proof\.js$)/;
function within(root, relative) {
  const target = path.resolve(root, relative), rest = path.relative(root, target);
  if (!rest || rest.startsWith('..') || path.isAbsolute(rest) || !allowed.test(relative)) throw new Error('Unexpected release target: ' + relative);
  return target;
}
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.release-tmp', content, { mode: 0o600 });
  fs.renameSync(file + '.release-tmp', file);
}
async function main() {
  const root = fs.realpathSync(arg('root'));
  const release = path.dirname(fileURLToPath(import.meta.url));
  const manifestText = fs.readFileSync(path.join(release, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  if (manifest.format !== 'coflow-platform-release/v1' || !/^[a-zA-Z0-9_-]+$/.test(manifest.id)) throw new Error('Invalid release manifest');
  const changes = [];
  for (const [relative, checksum] of Object.entries(manifest.files)) {
    const target = within(root, relative), source = within(path.join(release, 'payload'), relative);
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Invalid checksum');
    const content = fs.readFileSync(source);
    if (digest(content) !== checksum) throw new Error('Release checksum mismatch: ' + relative);
    // Historical migrations must stay identical to what was already deployed.
    if (relative.startsWith('prisma/migrations/') && fs.existsSync(target) && digest(fs.readFileSync(target)) !== checksum) throw new Error('Existing migration differs from release: ' + relative);
    if (!fs.existsSync(target) || digest(fs.readFileSync(target)) !== checksum) changes.push({ target, relative, content });
  }
  const require = createRequire(path.join(root, 'package.json'));
  const envFile = path.join(root, '.env'), originalEnv = fs.readFileSync(envFile, 'utf8');
  const env = require('dotenv').parse(originalEnv);
  const currentKey = env.SETTINGS_ENCRYPTION_KEY || '';
  if (currentKey && !/^[a-f0-9]{64}$/i.test(currentKey)) throw new Error('Existing SETTINGS_ENCRYPTION_KEY is invalid; refusing to replace it.');
  const marker = path.join(root, 'updates', 'applied-platform-release.json');
  const previous = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null;
  if (previous?.manifestHash === digest(manifestText) && !changes.length && currentKey) { console.log('Platform release already applied: ' + manifest.id); return; }
  if (process.argv.includes('--verify-only')) { console.log(`Release verified: ${manifest.id}; ${changes.length} changed files; encryption key ${currentKey ? 'preserved' : 'will be created'}. No changes made.`); return; }
  let listening = false;
  try { await fetch(`http://127.0.0.1:${Number(env.PORT || 3001)}/api/v1/health`, { signal: AbortSignal.timeout(1500) }); listening = true; } catch {}
  if (listening) throw new Error('Stop the existing CoFlow API before applying this release.');
  const dbUrl = new URL(env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(dbUrl.hostname)) throw new Error('This server updater requires the existing local PostgreSQL database.');
  const pgBin = path.join(root, 'runtime/postgres/bin'), pgData = path.join(root, '.data/postgres');
  if (!fs.existsSync(path.join(pgData, 'PG_VERSION'))) throw new Error('Existing PostgreSQL cluster is missing. No database will be initialized.');
  const pgCtl = path.join(pgBin, 'pg_ctl.exe');
  const status = spawnSync(pgCtl, ['-D', pgData, 'status'], { cwd: root, stdio: 'ignore', windowsHide: true });
  if (status.status !== 0) {
    const started = spawnSync(pgCtl, ['-D', pgData, '-l', path.join(root, '.data/postgres.log'), '-w', '-t', '30', 'start'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (started.status !== 0) throw new Error('Cannot start existing PostgreSQL; inspect .data/postgres.log.');
  }
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    await db.$connect();
    const history = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"');
    for (const row of history) {
      if (row.rolled_back_at) continue;
      if (!row.finished_at) throw new Error('An earlier migration is unfinished: ' + row.migration_name);
      if (manifest.files[`prisma/migrations/${row.migration_name}/migration.sql`] !== row.checksum) throw new Error('Database migration history does not match release: ' + row.migration_name);
    }
    if (!currentKey) {
      const tables = await db.$queryRawUnsafe('SELECT to_regclass($1::text)::text AS present', '"UserSettings"');
      if (tables[0]?.present) {
        const existing = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "UserSettings" WHERE "encryptedKey" IS NOT NULL');
        if (existing[0].count) throw new Error('Encrypted user keys already exist but the master key is missing; restore its original value before updating.');
      }
    }
  } finally { await db.$disconnect(); }
  const backup = path.join(root, 'backups', 'platform-' + manifest.id + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backup, { recursive: true });
  console.log('Release backup: ' + backup);
  const databaseBackup = path.join(backup, 'database.dump');
  const dumped = spawnSync(path.join(pgBin, 'pg_dump.exe'), ['-h', dbUrl.hostname.replace(/^\[|\]$/g, ''), '-p', dbUrl.port || '5432', '-U', decodeURIComponent(dbUrl.username), '-d', decodeURIComponent(dbUrl.pathname.slice(1)), '-Fc', '-f', databaseBackup], { cwd: root, env: { ...process.env, PGPASSWORD: decodeURIComponent(dbUrl.password) }, stdio: 'inherit', windowsHide: true });
  if (dumped.status !== 0 || !fs.existsSync(databaseBackup) || !fs.statSync(databaseBackup).size) throw new Error('Database backup failed; no application files were changed.');
  const listing = spawnSync(path.join(pgBin, 'pg_restore.exe'), ['--list', databaseBackup], { encoding: 'utf8', windowsHide: true });
  if (listing.status !== 0) throw new Error('Database backup could not be read; release not applied.');
  let updatedEnv = originalEnv;
  if (!currentKey) {
    const line = 'SETTINGS_ENCRYPTION_KEY=' + randomBytes(32).toString('hex');
    updatedEnv = /^SETTINGS_ENCRYPTION_KEY=.*$/m.test(originalEnv) ? originalEnv.replace(/^SETTINGS_ENCRYPTION_KEY=.*$/m, () => line) : originalEnv + '\n' + line + '\n';
  }
  const writes = [...changes, ...(updatedEnv !== originalEnv ? [{ target: envFile, relative: '.env', content: updatedEnv }] : [])];
  const restore = [];
  for (const [index, change] of writes.entries()) {
    const saved = fs.existsSync(change.target) ? path.join(backup, 'files', String(index)) : null;
    if (saved) { fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.copyFileSync(change.target, saved); }
    restore.push({ target: change.target, backup: saved });
  }
  // Always retain the original environment alongside the consistent database dump.
  fs.copyFileSync(envFile, path.join(backup, 'environment.before'));
  atomic(path.join(backup, 'restore.json'), JSON.stringify(restore, null, 2));
  try {
    for (const change of writes) atomic(change.target, change.content);
    const migrated = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'prisma/schema.prisma')], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
    if (migrated.status !== 0) throw new Error('Database migration failed');
    const fresh = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    try {
      const count = await fresh.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
      for (const table of ['RequirementTemplate', 'Competition', 'UserSettings', 'ProofBoard', 'ProjectFork', 'QQIntegration']) {
        const result = await fresh.$queryRawUnsafe('SELECT to_regclass($1::text)::text AS present', `"${table}"`);
        if (!result[0]?.present) throw new Error('Expected release table missing: ' + table);
      }
      atomic(marker, JSON.stringify({ id: manifest.id, manifestHash: digest(manifestText), appliedAt: new Date().toISOString(), backup, migrations: count[0].count }, null, 2));
    } finally { await fresh.$disconnect(); }
    console.log('Platform release applied: ' + manifest.id + '. Starting the website can now continue.');
  } catch (e) {
    for (const entry of restore.reverse()) {
      if (entry.backup) atomic(entry.target, fs.readFileSync(entry.backup));
      else if (fs.existsSync(entry.target)) fs.unlinkSync(entry.target);
    }
    throw new Error(e.message + '. Application files restored; completed additive migrations are retained. Database backup: ' + databaseBackup);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
