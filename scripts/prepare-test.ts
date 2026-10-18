import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith('/coflow_test') ||
  url === process.env.DATABASE_URL
)
  throw new Error('必须显式配置独立的 coflow_test 数据库');
process.env.DATABASE_URL = url;
process.env.SEED_PASSWORD =
  process.env.TEST_SEED_PASSWORD || 'CoFlow-test-only-2026!';
process.env.COFLOW_IMPORT_ONLY = '1';
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { env: process.env, stdio: 'inherit' },
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('测试库迁移失败')),
  );
});
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();
try {
  const { seed } = await import('../prisma/seed.js');
  await seed(db);
  console.log('隔离测试库迁移及演示账号已就绪，不清空任何已有数据。');
} finally {
  await db.$disconnect();
}
