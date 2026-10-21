import { storedFiles } from './storage-files.js';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
const db = new PrismaClient();
// Dry-run by default. 24-hour grace excludes uploads that have not committed yet.
try {
  const root = path.resolve(process.env.STORAGE_DIR || 'storage');
  const known = new Set((await storedFiles(db)).map((x) => x.key));
  const entries = await fs.readdir(root).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  for (const key of entries) {
    if (!/^(sf-)?[a-f0-9-]{36}(\.tmp)?$/.test(key) || known.has(key)) continue;
    const full = path.resolve(root, key);
    if (path.dirname(full) !== root) throw new Error('存储路径越界');
    const stat = await fs.stat(full);
    if (!stat.isFile() || Date.now() - stat.mtimeMs < 86400000) continue;
    console.log(
      `${process.argv.includes('--apply') ? '清理' : '可清理'}：${key}`,
    );
    if (process.argv.includes('--apply')) await fs.unlink(full);
  }
} finally {
  await db.$disconnect();
}
