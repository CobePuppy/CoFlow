import {
  planProofWork,
  proofStateLabels,
} from '../../../packages/contracts/proofloop.js';
import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import { Link } from 'react-router-dom';
import { api, useData, client } from './runtime.js';
import { labels, type Competition } from '../../../packages/contracts/index.js';

function downloadProof(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ProofLoop({
  competition,
  onClose,
}: {
  competition: Competition;
  onClose: () => void;
}) {
  const query = useData(
    ['proof', competition.id],
    `/competitions/${competition.id}/proof`,
  );
  const members = useData(
    ['members', competition.projectId],
    `/projects/${competition.projectId}/members`,
  );
  const settings = useData(['settings'], '/settings');
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<any>(),
    [taskItem, setTaskItem] = useState<any>();
  const [exportSnapshot, setExportSnapshot] = useState<any>();
  const [reviewing, setReviewing] = useState<any>();
  const [reviewForm] = Form.useForm();
  const [documentIds, setDocumentIds] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [sourceId, setSourceId] = useState<string>();
  const [form] = Form.useForm(),
    [owners] = Form.useForm();
  const [budget, setBudget] = useState(8);
  const data = query.data,
    documents = data?.documents || [];
  const plan = data
    ? planProofWork(data.data.claims, data.states, budget)
    : undefined;
  const source = documents.find((d: any) => d.id === sourceId);
  async function mutate(path: string, body: any) {
    setBusy(true);
    setError('');
    try {
      const result = await api(
        `/competitions/${competition.id}/proof/${path}`,
        'POST',
        body,
      );
      setExportSnapshot(undefined);
      await query.refetch();
      await client.invalidateQueries({ queryKey: ['tasks'] });
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const taskButton = (item: any, kind: string) =>
    item.taskId ? (
      <Space wrap>
        <Link to={`/?task=${item.taskId}`}>查看补证任务</Link>
        {data.tasks?.[item.taskId] && (
          <Tag>
            {data.tasks[item.taskId].deletedAt
              ? '需求已删除'
              : labels[data.tasks[item.taskId].status as keyof typeof labels] ||
                data.tasks[item.taskId].status}
          </Tag>
        )}
      </Space>
    ) : (
      <Button
        disabled={
          data.readOnly || busy || (kind === 'FINDING' && data.checkOutdated)
        }
        onClick={() => {
          owners.resetFields();
          setTaskItem({ ...item, kind });
        }}
      >
        转为补证任务
      </Button>
    );
  const docLink = (id: string) => (
    <Link
      to={`/?section=writing&workspace=${competition.workspaceId}&project=${competition.projectId}&document=${id}`}
    >
      打开文书
    </Link>
  );
  return (
    <Modal
      open
      className="proofloop-modal"
      title={'ProofLoop · ' + competition.name}
      width={1120}
      footer={null}
      onCancel={onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      style={{ top: 20 }}
    >
      <Alert
        type="info"
        showIcon
        message="让每一项成果，都经得起追问"
        description="登记主张与评分要求，关联文书证据，发现矛盾并推动补证。关联不等于事实已证实，AI疑点需要团队核对。"
      />
      {error && (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          message={error}
          action={
            <Button
              disabled={busy}
              onClick={() => {
                setExportSnapshot(undefined);
                query.refetch();
              }}
            >
              刷新记录
            </Button>
          }
        />
      )}
      {query.isPending ? (
        <Spin />
      ) : query.error ? (
        <Alert
          type="error"
          message={query.error.message}
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        />
      ) : (
        data && (
          <>
            {data.readOnly && <Alert type="warning" message="归档项目只读" />}
            <Space wrap style={{ margin: '16px 0' }}>
              <Button
                type="primary"
                disabled={busy || data.readOnly}
                onClick={() => {
                  form.resetFields();
                  setSourceId(undefined);
                  setEditing({});
                }}
              >
                登记成果主张
              </Button>
              <Button disabled={busy} onClick={() => query.refetch()}>
                刷新验证状态
              </Button>
              <span>
                共{data.data.claims.length}项 · 待补证
                {
                  Object.values(data.states).filter((v) => v === 'MISSING')
                    .length
                }
                项 · 证据过期
                {
                  Object.values(data.states).filter((v) => v === 'OUTDATED')
                    .length
                }
                项
              </span>
            </Space>
            {!data.data.claims.length && (
              <Empty description="先登记一个需要证明的结论，例如：在指定测试集上准确率达到95%" />
            )}
            <div className="document-grid">
              {data.data.claims.map((claim: any) => (
                <Card
                  key={claim.id}
                  title={claim.statement}
                  extra={
                    <Tag
                      color={
                        data.states[claim.id] === 'MISSING'
                          ? 'orange'
                          : data.states[claim.id] === 'OUTDATED'
                            ? 'red'
                            : data.states[claim.id] === 'VERIFIED'
                              ? 'green'
                              : data.states[claim.id] === 'REFUTED'
                                ? 'red'
                                : 'blue'
                      }
                    >
                      {
                        proofStateLabels[
                          data.states[claim.id] as keyof typeof proofStateLabels
                        ]
                      }
                    </Tag>
                  }
                >
                  <p>评分要求／验证口径：{claim.criterion || '待补充'}</p>
                  {claim.evidence.map((e: any, i: number) => (
                    <div
                      key={i}
                      style={{
                        borderLeft: '3px solid #0f766e',
                        paddingLeft: 12,
                        marginBottom: 12,
                      }}
                    >
                      <strong>
                        {documents.find((d: any) => d.id === e.documentId)
                          ?.title || '来源不可用'}{' '}
                        · v{e.version}
                      </strong>
                      <blockquote style={{ whiteSpace: 'pre-wrap' }}>
                        {e.quote}
                      </blockquote>
                      <p>{e.note}</p>
                      {docLink(e.documentId)}
                    </div>
                  ))}
                  {!!claim.reviews?.length && (
                    <details style={{ marginBottom: 12 }}>
                      <summary>
                        核对历史（{claim.reviews.length}条，保留最近20条）
                      </summary>
                      <p>
                        历史记录仅适用于当时的主张和证据版本，不能代替当前状态。
                      </p>
                      {[...claim.reviews]
                        .reverse()
                        .map((review: any, i: number) => (
                          <div key={i}>
                            <strong>
                              {review.outcome === 'SUPPORTED'
                                ? '支持'
                                : '不支持'}{' '}
                              ·{' '}
                              {members.data?.find(
                                (m: any) => m.id === review.by,
                              )?.name || review.by}
                            </strong>
                            <p>
                              {new Date(review.at).toLocaleString()} ·{' '}
                              {review.note}
                            </p>
                          </div>
                        ))}
                    </details>
                  )}
                  <Space wrap>
                    <Button
                      disabled={busy || data.readOnly}
                      onClick={() => {
                        setEditing(claim);
                        setSourceId(undefined);
                        form.setFieldsValue({
                          statement: claim.statement,
                          importance: claim.importance || 3,
                          effortHours: claim.effortHours || 2,
                          criterion: claim.criterion,
                          quote: '',
                          note: '',
                        });
                      }}
                    >
                      编辑与补充证据
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        data.readOnly ||
                        ['MISSING', 'OUTDATED'].includes(data.states[claim.id])
                      }
                      onClick={() => {
                        reviewForm.resetFields();
                        setReviewing(claim);
                      }}
                    >
                      人工核对
                    </Button>
                    {taskButton(claim, 'CLAIM')}
                  </Space>
                </Card>
              ))}
            </div>
            <Card title="下一步先补什么" style={{ marginTop: 20 }}>
              <Space wrap>
                <label htmlFor="proof-budget">可用补证时间（小时）</label>
                <InputNumber
                  id="proof-budget"
                  value={budget}
                  min={0.5}
                  max={80}
                  step={0.5}
                  onChange={(v) => setBudget(v || 0.5)}
                />
                <span>预算内最多3项 · 已安排{plan?.plannedHours}小时</span>
              </Space>
              <p className="muted">
                依据团队填写的重要度、预计工时和证据状态排序。优先值＝重要度×缺口系数÷工时；缺失/不支持为3、过期为2、待核对为1。为启发式建议，不是获奖分数，也不保证最优排期。
              </p>
              {!plan?.selected.length && (
                <p>
                  {data.data.claims.length
                    ? '当前预算内没有需要安排的条目，可调整工时或预算。'
                    : '登记主张后生成补证建议。'}
                </p>
              )}
              {plan?.selected.map((item, index) => (
                <div key={item.id} style={{ marginTop: 12 }}>
                  <strong>
                    {index + 1}. {item.statement}
                  </strong>
                  <p>
                    {
                      proofStateLabels[
                        data.states[item.id] as keyof typeof proofStateLabels
                      ]
                    }{' '}
                    · 重要度{item.importance} × 缺口{item.urgency} ÷{' '}
                    {item.hours}小时 = {item.priority.toFixed(2)}
                  </p>
                  {taskButton(item, 'CLAIM')}
                </div>
              ))}
            </Card>
            <Card title="提交与交接证据包" style={{ marginTop: 20 }}>
              <p>
                在同一个数据库快照中导出主张、证据正文与版本、核对历史、AI疑点、补证任务状态及未解决清单。源文书只包括关联和检查过的文书。
              </p>
              <Alert
                type="info"
                message="证据包包含关联文书正文，请确认分享范围"
                description="摘要用于检查文件是否变化，不证明事实真实性，也不是第三方认证。导出不会调用AI或自动提交材料。"
              />
              <Button
                style={{ marginTop: 12 }}
                loading={busy}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const snapshot = await api(
                      `/competitions/${competition.id}/proof/export`,
                    );
                    setExportSnapshot(snapshot);
                    message.success('交接快照已生成');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                生成交接证据包
              </Button>
              {exportSnapshot && (
                <>
                  <p>
                    生成于
                    {new Date(
                      exportSnapshot.payload.generatedAt,
                    ).toLocaleString()}{' '}
                    · 记录v{exportSnapshot.payload.boardVersion} · 待处理
                    {exportSnapshot.payload.unresolved.length}项
                  </p>
                  <p style={{ wordBreak: 'break-all' }}>
                    SHA-256：{exportSnapshot.digest}
                  </p>
                  <Space wrap>
                    <Button
                      onClick={() =>
                        downloadProof(
                          JSON.stringify(
                            {
                              digestAlgorithm: exportSnapshot.digestAlgorithm,
                              digest: exportSnapshot.digest,
                              payload: exportSnapshot.payload,
                            },
                            null,
                            2,
                          ),
                          competition.name + '-证据包.json',
                          'application/json;charset=utf-8',
                        )
                      }
                    >
                      下载JSON证据包
                    </Button>
                    <Button
                      onClick={() =>
                        downloadProof(
                          exportSnapshot.markdown,
                          competition.name + '-核对摘要.md',
                          'text/markdown;charset=utf-8',
                        )
                      }
                    >
                      下载Markdown核对摘要
                    </Button>
                  </Space>
                  <p className="muted">
                    两份文件使用同一个快照摘要。快照代表生成时的状态，后续修改或刷新后请重新生成。
                  </p>
                </>
              )}
            </Card>
            <Card title="跨文书矛盾检查" style={{ marginTop: 20 }}>
              <p>
                选择2—6份同项目文书，检查同一指标或结论是否矛盾。建议将实验结果、论文草稿和PPT内容分别保存为文书。原文和登记主张将发送给DeepSeek。
              </p>
              <Select
                mode="multiple"
                aria-label="选择核对文书"
                style={{ width: '100%' }}
                value={documentIds}
                onChange={setDocumentIds}
                disabled={busy || data.readOnly}
                options={documents.map((d: any) => ({
                  value: d.id,
                  label: d.title + ' · v' + d.version,
                }))}
              />
              <p>
                {settings.data?.hasKey
                  ? '使用个人设置中保存的DeepSeek配置。'
                  : '尚未保存API Key。'}{' '}
                <Link to="/?section=settings">管理AI设置</Link>
              </p>
              <Checkbox
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              >
                我确认发送所选文书和主张，并了解API调用可能计费
              </Checkbox>
              <p>
                <Button
                  loading={busy}
                  disabled={
                    busy ||
                    data.readOnly ||
                    !settings.data?.hasKey ||
                    !settings.data?.encryptionReady ||
                    documentIds.length < 2 ||
                    documentIds.length > 6 ||
                    !consent
                  }
                  onClick={async () => {
                    try {
                      const r = await mutate('check', {
                        documentIds,
                        expectedVersion: data.version,
                        consent: true,
                      });
                      message.success(`检查完成：${r.count}项待核对疑点`);
                    } catch {}
                  }}
                >
                  检查文书矛盾
                </Button>
              </p>
              {data.data.checked && (
                <p className="muted">
                  最近检查：{new Date(data.data.checked.at).toLocaleString()} ·{' '}
                  {data.data.checked.model} · 仅覆盖当次所选文书
                </p>
              )}
              {data.checkOutdated && (
                <Alert
                  type="warning"
                  message="主张或检查过的文书已变化，请重新检查；旧疑点不能继续转任务"
                />
              )}
              {data.data.checked && !data.data.findings.length && (
                <Alert
                  type="info"
                  message="本次未识别出有原文依据的直接矛盾，不代表项目已被证实或没有其他问题"
                />
              )}
              {data.data.findings.map((finding: any) => (
                <Card
                  key={finding.id}
                  size="small"
                  style={{ marginTop: 12 }}
                  title="AI疑点 · 待人工核对"
                >
                  <p>{finding.reason}</p>
                  {finding.sources.map((s: any, i: number) => (
                    <div key={i}>
                      <strong>
                        {documents.find((d: any) => d.id === s.documentId)
                          ?.title || '原文来源'}
                      </strong>
                      <blockquote style={{ whiteSpace: 'pre-wrap' }}>
                        {s.quote}
                      </blockquote>
                      {docLink(s.documentId)}
                    </div>
                  ))}
                  <p>建议：{finding.suggestion}</p>
                  {taskButton(finding, 'FINDING')}
                </Card>
              ))}
            </Card>
          </>
        )
      )}
      {editing && (
        <Modal
          open
          title="主张与验证证据"
          footer={null}
          width={800}
          onCancel={() => setEditing(undefined)}
          maskClosable={!busy}
          closable={!busy}
        >
          <Form
            form={form}
            initialValues={{ importance: 3, effortHours: 2 }}
            layout="vertical"
            disabled={busy}
            onFinish={async (values) => {
              try {
                const evidence = [
                  ...(editing.evidence || []),
                  ...(source
                    ? [
                        {
                          documentId: source.id,
                          version: source.version,
                          quote: values.quote?.trim() || '',
                          note: values.note || '',
                        },
                      ]
                    : []),
                ];
                await mutate('claims', {
                  claim: {
                    statement: values.statement,
                    criterion: values.criterion || '',
                    importance: values.importance,
                    effortHours: values.effortHours,
                    evidence,
                  },
                  ...(editing.id ? { claimId: editing.id } : {}),
                  expectedVersion: data.version,
                });
                setEditing(undefined);
                message.success('主张与证据已保存');
              } catch {}
            }}
          >
            <Form.Item
              name="statement"
              label="需要证明的主张"
              rules={[{ required: true, min: 5, max: 2000 }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item
              name="criterion"
              label="对应评分要求、指标口径或验证条件"
            >
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
            <Space wrap>
              <Form.Item
                name="importance"
                label="团队评估的重要度（1—5）"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={5} />
              </Form.Item>
              <Form.Item
                name="effortHours"
                label="预计补证工时"
                rules={[{ required: true }]}
              >
                <InputNumber min={0.5} max={80} step={0.5} />
              </Form.Item>
            </Space>
            {(editing.evidence || []).map((e: any, i: number) => (
              <p key={i}>
                已关联：
                {documents.find((d: any) => d.id === e.documentId)?.title} · v
                {e.version}{' '}
                <Button
                  type="link"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      evidence: editing.evidence.filter(
                        (_: any, n: number) => n !== i,
                      ),
                    })
                  }
                >
                  移除此关联
                </Button>
              </p>
            ))}
            <label>补充证据文书</label>
            <Select
              aria-label="证据文书"
              allowClear
              style={{ width: '100%', marginBottom: 12 }}
              value={sourceId}
              onChange={(value) => {
                setSourceId(value);
                form.setFieldValue('quote', '');
              }}
              options={documents.map((d: any) => ({
                value: d.id,
                label: d.title + ' · v' + d.version,
              }))}
            />
            {source && (
              <>
                <details>
                  <summary>查看来源原文并复制证据片段</summary>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      maxHeight: 250,
                      overflow: 'auto',
                    }}
                  >
                    {source.content}
                  </pre>
                </details>
                <Form.Item
                  name="quote"
                  label="证据原文（逐字连续引用）"
                  rules={[{ required: true, min: 5, max: 3000 }]}
                >
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item name="note" label="验证方法、实验条件与适用范围">
                  <Input.TextArea maxLength={2000} />
                </Form.Item>
              </>
            )}
            {error && <Alert type="error" message={error} />}
            <Button htmlType="submit" type="primary" loading={busy}>
              保存主张与证据
            </Button>
          </Form>
        </Modal>
      )}
      {reviewing && (
        <Modal
          open
          title="人工核对主张"
          footer={null}
          closable={!busy}
          maskClosable={!busy}
          keyboard={!busy}
          onCancel={() => setReviewing(undefined)}
        >
          <Alert
            type="info"
            message="任务完成不等于主张已成立"
            description="请自行核对原始实验、验证条件与引用。此记录是团队成员的署名判断，不是独立认证；主张或证据变化后需要重新核对。"
          />
          <p>{reviewing.statement}</p>
          <Form
            form={reviewForm}
            layout="vertical"
            initialValues={{ outcome: 'SUPPORTED' }}
            disabled={busy}
            onFinish={async (values) => {
              try {
                await mutate('review', {
                  claimId: reviewing.id,
                  expectedVersion: data.version,
                  ...values,
                });
                setReviewing(undefined);
                message.success('署名核对已记录');
              } catch {}
            }}
          >
            <Form.Item
              name="outcome"
              label="核对结论"
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { value: 'SUPPORTED', label: '现有证据支持该主张' },
                  { value: 'REFUTED', label: '现有证据不支持该主张' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="note"
              label="核对依据与适用范围（至少20字）"
              rules={[{ required: true, min: 20, max: 3000 }]}
            >
              <Input.TextArea rows={5} />
            </Form.Item>
            {error && <Alert type="error" message={error} />}
            <Button htmlType="submit" type="primary" loading={busy}>
              记录署名核对
            </Button>
          </Form>
        </Modal>
      )}
      {taskItem && (
        <Modal
          open
          title="将问题转为补证任务"
          footer={null}
          onCancel={() => setTaskItem(undefined)}
          closable={!busy}
          maskClosable={!busy}
          keyboard={!busy}
        >
          <p>
            创建普通需求草稿，保留原始主张或疑点及引用；后续沿用项目交付与验收流程。
          </p>
          <Form
            form={owners}
            layout="vertical"
            disabled={busy}
            onFinish={async (values) => {
              try {
                const result = await mutate('task', {
                  itemId: taskItem.id,
                  kind: taskItem.kind,
                  expectedVersion: data.version,
                  owners: values,
                });
                setTaskItem(undefined);
                message.success('补证任务已创建');
                void result;
              } catch {}
            }}
          >
            {members.error && (
              <Alert type="error" message={members.error.message} />
            )}
            {Object.entries({
              productId: '产品负责人',
              engineerId: '研发负责人',
              productReviewerId: '产品评估人',
              qaReviewerId: '测试评估人',
              testerId: '测试负责人',
            }).map(([key, label]) => (
              <Form.Item
                key={key}
                name={key}
                label={label}
                rules={[{ required: true }]}
              >
                <Select
                  aria-label={label}
                  showSearch
                  optionFilterProp="label"
                  options={(members.data || []).map((m: any) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                />
              </Form.Item>
            ))}
            <p className="muted">
              产品和测试评估人须为不同账号；方案提交人与评估人的职责分离沿用项目规则。
            </p>
            {error && <Alert type="error" message={error} />}
            <Button type="primary" htmlType="submit" loading={busy}>
              创建补证任务
            </Button>
          </Form>
        </Modal>
      )}
    </Modal>
  );
}
