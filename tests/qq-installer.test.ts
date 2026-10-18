import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('安装器仅在本机数据库不可达时启动现有集群，预检和鉴权失败不启动', async () => {
  const file = path.resolve('integrations/qq-agent/install.mjs');
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/^import .+;\r?$/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
  const code = source.slice(0, source.lastIndexOf('main().catch'));
  async function run(
    options: {
      verify?: boolean;
      error?: string;
      remote?: boolean;
      status?: number;
      start?: number;
      answers?: string[];
    } = {},
  ) {
    const calls: string[] = [];
    const answers = [...(options.answers || [])];
    let connections = 0;
    const db = {
      async $connect() {
        calls.push('connect');
        if (!connections++ && !options.answers)
          throw Object.assign(new Error('offline'), {
            errorCode: options.error || 'P1001',
          });
      },
      async $disconnect() {
        calls.push('disconnect');
      },
      workspace: {
        async findMany() {
          calls.push('query');
          if (options.answers)
            return [
              { id: 'team-1', name: 'Team One' },
              { id: 'team-2', name: 'Team Two' },
            ];
          throw new Error('QUERY_REACHED');
        },
      },
    };
    const fakeFs = {
      realpathSync: (s: string) => path.resolve(s),
      existsSync: () => true,
      readFileSync: (s: string) =>
        s.endsWith('config.js')
          ? 'export const DATA_DIR = "data";'
          : s.endsWith('config.json')
            ? '{}'
            : '',
    };
    const fakeRequire = (name: string) =>
      name === 'dotenv'
        ? {
            parse: () => ({
              DATABASE_URL: `postgresql://test:unused@${options.remote ? '192.0.2.1' : '127.0.0.1'}:55439/coflow`,
            }),
          }
        : {
            PrismaClient: class {
              constructor() {
                return db;
              }
            },
          };
    const context = vm.createContext({
      fs: fakeFs,
      path,
      fileURLToPath,
      URL,
      createRequire: () => fakeRequire,
      createInterface: () => ({
        async question() {
          calls.push('question');
          return answers.shift() || 'q';
        },
        close() {
          calls.push('input-closed');
        },
      }),
      process: {
        argv: [
          'node',
          file,
          '--coflow',
          'fixture/CoFlow',
          '--agent',
          'fixture/QQ Agent',
          ...(options.verify ? ['--verify-only'] : []),
          ...(options.answers ? ['--interactive'] : []),
        ],
        env: {},
        execPath: process.execPath,
      },
      console: { log() {} },
      spawnSync: (_exe: string, args: string[]) => {
        const action = args.at(-1) === 'status' ? 'status' : 'start';
        calls.push(action);
        return {
          status:
            action === 'status' ? (options.status ?? 3) : (options.start ?? 0),
        };
      },
    });
    const testedCode = options.answers
      ? code.replace(
          "  const webUrl = arg('web-url')",
          "  throw new Error('SELECTED_WORKSPACE:' + workspaceId);\n  const webUrl = arg('web-url')",
        )
      : code;
    vm.runInContext(testedCode + '\nglobalThis.runInstaller = main;', context);
    let error = '';
    try {
      await context.runInstaller();
    } catch (e: any) {
      error = e.message;
    }
    return { calls, error };
  }
  const stopped = await run();
  assert.deepEqual(stopped.calls, [
    'connect',
    'status',
    'start',
    'connect',
    'query',
    'disconnect',
  ]);
  assert.equal(stopped.error, 'QUERY_REACHED');
  assert.deepEqual((await run({ verify: true })).calls, [
    'connect',
    'disconnect',
  ]);
  assert.deepEqual((await run({ error: 'P1000' })).calls, [
    'connect',
    'disconnect',
  ]);
  assert.deepEqual((await run({ remote: true })).calls, [
    'connect',
    'disconnect',
  ]);
  assert.deepEqual((await run({ status: 0 })).calls, [
    'connect',
    'status',
    'disconnect',
  ]);
  assert.deepEqual((await run({ start: 1 })).calls, [
    'connect',
    'status',
    'start',
    'disconnect',
  ]);
  const selected = await run({ answers: ['invalid', '2'] });
  assert.equal(selected.error, 'SELECTED_WORKSPACE:team-2');
  assert.equal(selected.calls.filter((c) => c === 'question').length, 2);
  assert.equal(selected.calls.at(-1), 'input-closed');
  const cancelled = await run({ answers: ['q'] });
  assert.match(cancelled.error, /Installation cancelled/);
  assert.equal(cancelled.calls.at(-1), 'input-closed');
});
