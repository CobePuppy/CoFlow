import test from 'node:test';
import assert from 'node:assert/strict';
import { publicHistory } from '../../scripts/release/product-info.js';
test('用户更新历史保留真实版本和详情，排除内部部署验证与非版本标题', () => {
  const rows = publicHistory(
    '# 更新记录\n\n## 3.3.0 — 2026-10-20\n- 类别：frontend、feature；前端3.3.0\n- 设置新增关于汇流。\n- 验证：内部测试日志\n- 状态：released；部署到10.16.7.124\n\n## 3.1.1 — 2026-10-20\n- 浅绿色侧栏。\n\n## 历史产品里程碑\n- 未核实日期',
  );
  assert.deepEqual(
    rows.map((x) => x.version),
    ['3.3.0', '3.1.1'],
  );
  assert.deepEqual(rows[0].categories, ['frontend', 'feature']);
  assert.deepEqual(rows[0].changes, ['设置新增关于汇流。']);
  assert.equal(JSON.stringify(rows).includes('10.16.7.124'), false);
});
