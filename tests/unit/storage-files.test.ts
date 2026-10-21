import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedFiles } from '../../scripts/maintenance/storage-files.js';
test('备份和清理同时保留项目附件、个人及团队文件，包括已删除文件', async () => {
  const db = {
    $queryRaw: async () => [{ name: 'SpaceFile' }],
    attachment: { findMany: async () => [{ key: 'project' }] },
    spaceFileRevision: {
      findMany: async () => [{ key: 'sf-personal' }, { key: 'sf-history' }],
    },
    spaceFile: {
      findMany: async (options: any) => {
        assert.equal(options.where, undefined);
        return [{ key: 'sf-personal' }, { key: 'sf-team-deleted' }];
      },
    },
  };
  assert.deepEqual(
    (await storedFiles(db)).map((f) => f.key),
    ['project', 'sf-personal', 'sf-team-deleted', 'sf-history'],
  );
});
test('旧备份没有独立文件表时仍能恢复，存在表但查询失败必须停止清理', async () => {
  const db = {
    $queryRaw: async () => [{ name: null }],
    attachment: { findMany: async () => [{ key: 'legacy' }] },
    spaceFileRevision: { findMany: async () => [] },
    spaceFile: {
      findMany: async () => {
        throw new Error('database unavailable');
      },
    },
  };
  assert.deepEqual(await storedFiles(db), [{ key: 'legacy' }]);
  await assert.rejects(
    () =>
      storedFiles({ ...db, $queryRaw: async () => [{ name: 'SpaceFile' }] }),
    /database unavailable/,
  );
});

test('历史版本表存在但读取失败时停止备份与清理，不能忽略历史文件', async () => {
  await assert.rejects(
    storedFiles({
      $queryRaw: async () => [{ name: 'exists' }],
      attachment: { findMany: async () => [] },
      spaceFile: { findMany: async () => [] },
      spaceFileRevision: {
        findMany: async () => {
          throw Error('history unavailable');
        },
      },
    }),
    /history unavailable/,
  );
});
