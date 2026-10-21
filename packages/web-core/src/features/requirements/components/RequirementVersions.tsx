import { useState } from 'react';
import { Alert, Card, Empty, Select, Space, Tag } from 'antd';
import { requirementDiff } from '../model/requirement-diff.js';
import './requirement-versions.css';
export function RequirementDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}) {
  const changes = requirementDiff(before, after);
  return (
    <div className="requirement-diff">
      {!changes.length ? (
        <Empty description="所选版本的需求字段没有变化" />
      ) : (
        changes.map((c) => (
          <section key={c.field}>
            <h4>
              {c.label} {c.unknownBefore && <Tag>旧版本未记录此字段</Tag>}
            </h4>
            {c.field === 'criteria' && (
              <p>
                新增 {c.added.length} 项 · 移除 {c.removed.length} 项
                {!c.added.length && !c.removed.length
                  ? ' · 顺序调整或重复项变化'
                  : ''}
              </p>
            )}
            <div className="requirement-diff-columns">
              <div>
                <strong>变更前</strong>
                <pre>
                  {c.unknownBefore
                    ? '旧版本未记录'
                    : Array.isArray(c.before)
                      ? c.before.map((x) => '• ' + x).join('\n')
                      : c.before || '未填写'}
                </pre>
              </div>
              <div>
                <strong>变更后</strong>
                <pre>
                  {Array.isArray(c.after)
                    ? c.after.map((x) => '• ' + x).join('\n')
                    : c.after || '未填写'}
                </pre>
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
export function RequirementVersions({ task }: { task: any }) {
  const versions = task.data.requirements as any[];
  const [chosen, setChosen] = useState<number>();
  const [baseline, setBaseline] = useState<number>();
  const after = versions.find((r) => r.version === chosen) || versions.at(-1);
  if (!after) return null;
  const older = versions.filter((r) => r.version < after.version);
  const before =
    older.find((r) => r.version === baseline) || older.at(-1) || null;
  const change =
    after.version > 1
      ? task.data.changes.find(
          (c: any) => c.decision === 'CONFIRMED' && c.at === after.at,
        )
      : null;
  return (
    <Card title="需求版本对比" size="small">
      <Space wrap>
        <span>查看版本</span>
        <Select
          aria-label="查看需求版本"
          value={after.version}
          onChange={(v) => {
            setChosen(v);
            setBaseline(undefined);
          }}
          options={versions.map((r) => ({
            value: r.version,
            label: '需求 v' + r.version,
          }))}
        />
        {before && (
          <>
            <span>对比基准</span>
            <Select
              aria-label="对比基准版本"
              value={before.version}
              onChange={setBaseline}
              options={older.map((r) => ({
                value: r.version,
                label: '需求 v' + r.version,
              }))}
            />
          </>
        )}
      </Space>
      <p>
        {before
          ? '需求 v' + before.version + ' → v' + after.version
          : '首次提交，无上一版'}{' '}
        ·{' '}
        {new Date(after.at).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
        })}
      </p>
      {change && (
        <Alert
          type="info"
          message={'变更原因：' + change.reason}
          description={'影响说明：' + change.impact}
        />
      )}
      <RequirementDiff before={before} after={after} />
      {after.version > 1 && (
        <Alert
          type="warning"
          message="本次需求变更需要重新确认交付内容"
          description={
            task.data.workflow === 'SIMPLE'
              ? '变更确认后回到待办，执行人按新版需求重新处理并提交验收。'
              : '变更确认后重新出方案并由产品、测试分别评估。旧评估保留在历史中，不沿用于新版方案；当时尚未结束的测试轮次作废。'
          }
        />
      )}
    </Card>
  );
}
