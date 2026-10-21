import { useState, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Select,
  Space,
  Tag,
  App,
  Empty,
} from 'antd';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from '../../shared/api/runtime.js';
import { editionHome } from '../../app/edition.js';

const kindLabels: Record<string, string> = {
  REQUIREMENT: '需求文档',
  SOLUTION: '研发方案',
  TEST: '测试结果',
};
const outcomeLabels: Record<string, string> = {
  PASSED: '文档检查通过',
  NEEDS_CHANGES: '需要修改',
  INSUFFICIENT: '材料不足',
};
export default function AIQuality({ task }: any) {
  const settings = useData(['settings'], '/settings');
  const reports = useData(
    ['aiReviews', task.id, task.version],
    '/tasks/' + task.id + '/ai-reviews',
  );
  const documents = useData(
    ['taskDocuments', task.id],
    '/tasks/' + task.id + '/documents',
  );
  const [kind, setKind] = useState('REQUIREMENT'),
    [ids, setIds] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setConsent(false);
  }, [task.version]);
  useEffect(() => {
    setIds([]);
  }, [task.id]);
  const qc = useQueryClient();
  const { message } = App.useApp();
  return (
    <section>
      <Alert
        type="info"
        showIcon
        message="AI评审检查材料质量，供人工评估参考"
        description="对照需求、最新研发方案、研发交接及最新测试记录，可额外选择关联文档。评审不执行代码或测试，不替代双人评估和人工验收，也不自动修改状态。"
      />
      {!settings.data?.hasKey && (
        <Alert
          type="warning"
          message={
            <span>
              尚未配置个人API Key，请到
              <Link to={editionHome + '?section=settings&settingsTab=ai'}>
                个人AI设置
              </Link>
              保存并验证DeepSeek Key。
            </span>
          }
        />
      )}
      {settings.error && (
        <Alert type="error" message={settings.error.message} />
      )}
      <Space wrap style={{ margin: '16px 0' }}>
        <Select
          aria-label="AI评审类型"
          value={kind}
          disabled={busy}
          onChange={(v) => {
            setKind(v);
            setConsent(false);
          }}
          options={Object.entries(kindLabels).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Select
          aria-label="评审关联文档"
          mode="multiple"
          maxCount={5}
          placeholder="附加关联文档（最多5份）"
          style={{ minWidth: 260, maxWidth: '100%' }}
          value={ids}
          disabled={busy}
          onChange={(v) => {
            setIds(v);
            setConsent(false);
          }}
          options={documents.data?.map((d: any) => ({
            value: d.id,
            label: d.title,
          }))}
        />
      </Space>
      {documents.error && (
        <Alert type="error" message={documents.error.message} />
      )}
      <p>
        使用个人设置模型：{settings.data?.model || 'DeepSeek'}
        。发送当前需求、最新方案/交接/测试记录及选中的关联文档正文，单次最多10万字符。
      </p>
      <Checkbox
        checked={consent}
        disabled={busy}
        onChange={(e) => setConsent(e.target.checked)}
      >
        同意将上述资料发送至DeepSeek，可能产生个人API费用
      </Checkbox>
      <p>
        <Button
          type="primary"
          loading={busy}
          disabled={task.readOnly || !consent || !settings.data?.hasKey}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api('/tasks/' + task.id + '/ai-reviews', 'POST', {
                kind,
                documentIds: ids,
                expectedVersion: task.version,
                consent: true,
              });
              setConsent(false);
              await qc.invalidateQueries();
              message.success('评审已保存，请查看问题与依据');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          开始AI评审
        </Button>
      </p>
      {error && <Alert type="error" message={error} />}
      {reports.error && (
        <Alert
          type="error"
          message={reports.error.message}
          action={
            <Button onClick={() => reports.refetch()}>重试加载记录</Button>
          }
        />
      )}
      {!reports.isPending && !reports.data?.items.length && (
        <Empty description="暂无AI评审记录" />
      )}
      {reports.data?.items.map((r: any) => (
        <Card
          className="history-card"
          key={r.id}
          title={kindLabels[r.kind] + ' · ' + outcomeLabels[r.result.outcome]}
          extra={<Tag>{r.stale ? '资料已变更 · 需重评' : '当前资料'}</Tag>}
        >
          <p>{r.result.summary}</p>
          <p className="muted">
            {new Date(r.at).toLocaleString('zh-CN')} · {r.model} ·
            评审前需求版本 {r.taskVersion}
          </p>
          {r.stale && (
            <Alert
              type="warning"
              message="本报告针对旧资料，请勿将其用于当前版本的通过判断"
            />
          )}
          {r.result.checks.map((c: any, i: number) => (
            <div
              key={i}
              style={{
                borderTop: '1px solid var(--line)',
                padding: '12px 0',
                overflowWrap: 'anywhere',
              }}
            >
              <strong>
                <Tag
                  color={
                    c.status === 'PASS'
                      ? 'green'
                      : c.status === 'FAIL'
                        ? 'red'
                        : 'orange'
                  }
                >
                  {
                    { PASS: '符合', FAIL: '需修改', MISSING: '缺材料' }[
                      c.status as string
                    ]
                  }
                </Tag>
                {c.criterion}
              </strong>
              <p>{c.explanation}</p>
              {c.evidence.map((e: any, j: number) => (
                <blockquote key={j}>
                  <small>
                    来源：
                    {{
                      requirement: '需求',
                      solution: '研发方案',
                      development: '研发交接',
                      test: '测试记录',
                    }[e.sourceId as string] ||
                      documents.data?.find((d: any) => d.id === e.sourceId)
                        ?.title ||
                      '关联文档'}
                  </small>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{e.quote}</p>
                </blockquote>
              ))}
              {c.suggestion && <p>修改建议：{c.suggestion}</p>}
            </div>
          ))}
          <Button
            onClick={() => {
              const blob = new Blob([JSON.stringify(r, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'CoFlow-AI评审-' + r.id + '.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            导出评审记录
          </Button>
        </Card>
      ))}
    </section>
  );
}
