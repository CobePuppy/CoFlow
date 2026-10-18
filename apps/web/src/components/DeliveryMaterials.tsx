import { AttachmentPanel } from './AttachmentPanel.js';
import { Alert, Button, Card, Empty, Tag, Modal, Space } from 'antd';
import { useState } from 'react';
import { Markdown } from './Markdown.js';

export function DeliveryMaterials({
  task,
  begin,
  section,
}: {
  task: any;
  begin: any;
  section: 'development' | 'testing';
}) {
  const d = task.data;
  const [testImport, setTestImport] = useState<{ id: string; name: string }>();
  const can = (key: string) =>
    !task.readOnly && task.allowedActions.includes(key);
  const action = (key: string, label: string) =>
    !task.readOnly && task.allowedActions.includes(key) ? (
      <Button onClick={() => begin(key)}>{label}</Button>
    ) : null;
  return (
    <div className="delivery-materials">
      {section === 'development' && (
        <>
          <Card
            title="技术方案"
            extra={action('SUBMIT_SOLUTION', '填写技术方案')}
          >
            <p className="muted">
              开发前明确实现方式、影响范围、工作量和风险，交由产品与测试分别评估。
            </p>
            {!d.solutions.length && <Empty description="尚未提交技术方案" />}
            {[...d.solutions].reverse().map((s: any) => (
              <section className="delivery-record" key={s.version}>
                <strong>
                  方案 v{s.version} · 需求 v{s.requirementVersion}
                </strong>
                <Markdown>{s.body}</Markdown>
                <p>范围：{s.scope}</p>
                <p>风险：{s.risk}</p>
                <p>
                  {s.effort} 人日 · {s.start} 至 {s.end}
                </p>
                {['PRODUCT', 'QA'].map((slot) => {
                  const r = d.reviews.find(
                    (r: any) => r.round === s.version && r.slot === slot,
                  );
                  return (
                    <p key={slot}>
                      <Tag
                        color={r ? (r.approved ? 'green' : 'red') : 'default'}
                      >
                        {slot === 'PRODUCT' ? '产品评估' : '测试评估'}：
                        {r ? (r.approved ? '通过' : '退回') : '待评估'}
                      </Tag>
                      {r?.reason}
                    </p>
                  );
                })}
                {d.reviewSnapshot?.solutionVersion === s.version && (
                  <Alert
                    type="success"
                    message="双人评估已通过，评估快照已冻结"
                  />
                )}
              </section>
            ))}
            <AttachmentPanel
              taskId={task.id}
              stage="SOLUTION"
              readOnly={task.readOnly}
              onParse={
                can('SUBMIT_SOLUTION')
                  ? (file) => begin('SUBMIT_SOLUTION', file)
                  : undefined
              }
              parseUnavailableReason={
                can('SUBMIT_SOLUTION')
                  ? undefined
                  : '需由当前阶段的研发负责人填写技术方案'
              }
            />
            <AttachmentPanel
              taskId={task.id}
              stage="REVIEW"
              readOnly={task.readOnly}
            />
          </Card>
          <Card
            title="开发交付与自测"
            extra={action('COMPLETE_DEVELOPMENT', '填写开发交接')}
          >
            <p className="muted">
              提交实现说明、自测结果、版本、环境与已知问题，方便测试接手。
            </p>
            {!d.development.length && (
              <Empty description="尚未提交开发交接记录" />
            )}
            {[...d.development].reverse().map((x: any, i: number) => (
              <section className="delivery-record" key={i}>
                <strong>
                  提测 #{x.round} · {x.releaseVersion}
                </strong>
                <Markdown>{x.summary}</Markdown>
                <p>自测：{x.selfTest}</p>
                <p>环境：{x.environment}</p>
                <p>已知问题：{x.knownIssues}</p>
              </section>
            ))}
            <AttachmentPanel
              taskId={task.id}
              stage="DEVELOPMENT"
              readOnly={task.readOnly}
              onParse={
                can('COMPLETE_DEVELOPMENT')
                  ? (file) => begin('COMPLETE_DEVELOPMENT', file)
                  : undefined
              }
              parseUnavailableReason={
                can('COMPLETE_DEVELOPMENT')
                  ? undefined
                  : '开发进行中时，由研发负责人填写开发交接'
              }
            />
          </Card>
        </>
      )}
      {section === 'testing' && (
        <Card title="测试与验收" extra={action('START_TEST', '填写测试环境')}>
          {d.type === 'BUG' && (
            <Alert
              message={`关联父任务 ${d.parentId} · 测试轮次 ${d.parentRound} · ${d.severity}`}
            />
          )}
          <p className="muted">
            本任务 ID：<code>{task.id}</code>（关联缺陷时使用）
          </p>
          {!d.tests.length && <Empty description="尚未开始测试" />}
          {[...d.tests].reverse().map((x: any) => (
            <section className="delivery-record" key={x.round}>
              <strong>
                测试轮次 #{x.round} · {x.status}
              </strong>
              <p>环境：{x.environment || '待填写'}</p>
              <Markdown>{x.record || ''}</Markdown>
              <p>部署验证：{x.deployment || '待填写'}</p>
              {x.reason && <Alert type="warning" message={x.reason} />}
              <p>缺陷：{x.defectIds?.join('、') || '无'}</p>
            </section>
          ))}
          {d.acceptances.map((a: any, i: number) => (
            <Alert
              key={i}
              type="success"
              message={`需求 v${a.requirementVersion} 已逐项验收 · ${new Date(a.at).toLocaleString('zh-CN')}`}
            />
          ))}
          <AttachmentPanel
            taskId={task.id}
            stage="TESTING"
            readOnly={task.readOnly}
            onParse={
              can('START_TEST')
                ? (file) => begin('START_TEST', file)
                : can('PASS_TEST') || can('FAIL_TEST')
                  ? setTestImport
                  : undefined
            }
            parseUnavailableReason={
              can('START_TEST') || can('PASS_TEST') || can('FAIL_TEST')
                ? undefined
                : '需由当前阶段的测试负责人填写测试资料'
            }
          />
          <AttachmentPanel
            taskId={task.id}
            stage="ACCEPTANCE"
            readOnly={task.readOnly}
          />
        </Card>
      )}
      <Modal
        open={!!testImport}
        title="选择测试记录的填写入口"
        onCancel={() => setTestImport(undefined)}
        footer={null}
      >
        <p>
          文件解析只填入记录，不自动判断通过或失败。请选择要填写的表单，核对后再提交。
        </p>
        <Space wrap>
          {can('PASS_TEST') && (
            <Button
              onClick={() => {
                begin('PASS_TEST', testImport);
                setTestImport(undefined);
              }}
            >
              填写通过记录
            </Button>
          )}
          {can('FAIL_TEST') && (
            <Button
              onClick={() => {
                begin('FAIL_TEST', testImport);
                setTestImport(undefined);
              }}
            >
              填写失败记录
            </Button>
          )}
          <Button onClick={() => setTestImport(undefined)}>暂不导入</Button>
        </Space>
      </Modal>
    </div>
  );
}
