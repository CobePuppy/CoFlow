import { storedFiles } from './storage-files.js';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const restore = process.argv.includes('--restore');
const configured = restore
  ? process.env.RESTORE_DATABASE_URL
  : process.env.DATABASE_URL;
if (!configured) throw new Error('必须显式配置数据库地址');
const url = new URL(configured);
if (
  restore &&
  (!/^\/coflow_restore(?:_[a-z0-9]+)?$/.test(url.pathname) ||
    configured === process.env.DATABASE_URL ||
    configured === process.env.TEST_DATABASE_URL)
)
  throw new Error('恢复仅允许独立 coflow_restore 数据库，禁止覆盖开发和测试库');
const root = path.resolve(
  process.env.BACKUP_DIR ||
    `backups/${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const storage = path.resolve(
  restore
    ? process.env.RESTORE_STORAGE_DIR || 'storage-restore'
    : process.env.STORAGE_DIR || 'storage',
);
const db = new PrismaClient({ datasources: { db: { url: configured } } });
function pg(name: string, args: string[]) {
  const executable = process.env.PG_BIN
    ? path.join(
        process.env.PG_BIN,
        name + (process.platform === 'win32' ? '.exe' : ''),
      )
    : name;
  return new Promise<void>((resolve, reject) => {
    const c = spawn(executable, args, {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.slice(1),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    c.stderr.on('data', (d) => (error += d));
    c.on('error', reject);
    c.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${name} 失败（${code}），检查目标环境和权限。${error.replaceAll(decodeURIComponent(url.password) || '\0', '[redacted]')}`,
            ),
          ),
    );
  });
}
async function digest(file: string) {
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}
try {
  if (restore) {
    if (!process.env.BACKUP_DIR) throw new Error('恢复必须显式指定 BACKUP_DIR');
    const tables: any[] =
      await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
    if (tables.length) throw new Error('恢复目标必须是空库，不执行清空操作');
    try {
      await fs.access(storage);
      throw new Error('恢复附件目录已存在，请指定新的 RESTORE_STORAGE_DIR');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, 'manifest.json'), 'utf8'),
    );
    if (
      (await digest(path.join(root, 'database.backup'))) !==
      manifest.databaseSha256
    )
      throw new Error('备份校验和不符');
    await pg('pg_restore', [
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '-d',
      url.pathname.slice(1),
      path.join(root, 'database.backup'),
    ]);
    await fs.cp(path.join(root, 'attachments'), storage, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if ((await db.task.count()) !== manifest.tasks)
      throw new Error('恢复后任务数量不符');
    const files = await storedFiles(db);
    if (files.length !== manifest.files.length)
      throw new Error('恢复后附件元数据数量不符');
    for (const f of files)
      if (
        (await digest(path.join(storage, f.key))) !==
        manifest.files.find((x: any) => x.key === f.key)?.sha256
      )
        throw new Error('恢复后附件校验和不符');
    console.log('隔离恢复验证通过：任务数量、附件元数据及 SHA-256 一致。');
  } else {
    await fs.mkdir(root, { recursive: true });
    const files = await storedFiles(db);
    await fs.mkdir(path.join(root, 'attachments'));
    const entries = [];
    for (const f of files) {
      const input = path.join(storage, f.key);
      entries.push({ key: f.key, sha256: await digest(input) });
      await fs.copyFile(input, path.join(root, 'attachments', f.key));
    }
    await pg('pg_dump', [
      '--format=custom',
      '--file',
      path.join(root, 'database.backup'),
    ]);
    await fs.writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          tasks: await db.task.count(),
          files: entries,
          databaseSha256: await digest(path.join(root, 'database.backup')),
        },
        null,
        2,
      ),
    );
    console.log(`备份完成：${root}`);
  }
} finally {
  await db.$disconnect();
}
