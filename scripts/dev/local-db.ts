import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const data = path.join(root, '.local-pg');
const bin =
  process.env.PG_BIN ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\PostgreSQL\\18\\bin'
    : '');
const executable = (name: string) =>
  bin
    ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
    : name;
const run = (name: string, args: string[]) =>
  spawnSync(executable(name), args, { encoding: 'utf8', windowsHide: true });
const check = () => run('pg_isready', ['-h', '127.0.0.1', '-p', '55432']);
if (!fs.existsSync(path.join(data, 'PG_VERSION')))
  throw new Error(
    '项目尚无 .local-pg 集群，请按 README 配置数据库；不会自动初始化或覆盖数据',
  );
let result = check();
if (result.error) throw new Error('未找到 PostgreSQL 工具，请设置 PG_BIN');
if (result.status === 0) {
  const status = run('pg_ctl', ['-D', data, 'status']);
  if (status.status !== 0)
    throw new Error(
      '55432 已就绪，但无法确认项目集群进程状态；可能是进程读取受限或其他实例占用。请在允许读取本地进程状态的终端检查；未启动额外实例',
    );
  console.log('项目 PostgreSQL 已就绪：127.0.0.1:55432');
} else if (process.argv.includes('--start')) {
  result = run('pg_ctl', [
    '-D',
    data,
    '-l',
    path.join(root, '.local-pg.log'),
    '-o',
    '-p 55432 -h 127.0.0.1',
    '-w',
    '-t',
    '30',
    'start',
  ]);
  if (result.status !== 0) {
    console.error(result.stderr || '数据库启动失败，请检查 .local-pg.log');
    console.error(
      '若出现 restricted token / 错误 87，请在允许启动本地服务的终端执行 pnpm db:local:start。',
    );
    process.exitCode = 1;
  } else if (check().status !== 0)
    throw new Error('数据库已启动但健康检查未通过');
  else console.log('项目 PostgreSQL 已启动并通过健康检查');
} else {
  console.error(
    '项目 PostgreSQL 未就绪；运行 pnpm db:local:start 启动已有集群。',
  );
  process.exitCode = 1;
}
