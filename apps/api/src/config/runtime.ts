import dotenv from 'dotenv';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
function findRoot() {
  if (process.env.COFLOW_ROOT) return path.resolve(process.env.COFLOW_ROOT);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (path.dirname(dir) !== dir) {
    if (
      fs.existsSync(path.join(dir, 'version.json')) &&
      fs.existsSync(path.join(dir, 'prisma'))
    )
      return dir;
    dir = path.dirname(dir);
  }
  throw new Error('无法定位 CoFlow 根目录，请设置 COFLOW_ROOT');
}
export const root = findRoot();
dotenv.config({ path: path.join(root, '.env'), quiet: true });
export const runtimeConfig = {
  root,
  origin: process.env.APP_ORIGIN || 'http://localhost:5173',
  storage: path.resolve(root, process.env.STORAGE_DIR || 'storage'),
};
