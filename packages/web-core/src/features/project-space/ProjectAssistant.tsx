import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  List,
  Space,
  Tag,
  Typography,
} from 'antd';
import { api, client, useData } from '../../shared/api/runtime.js';
import { createClientId } from '../../shared/lib/client-id.js';
import type { ProjectPlan } from '@coflow/contracts/project-assistant.js';

type Source = {
  id: string;
  number: number;
  version: number;
  title: string;
  handlerIds: string[];
  signals: string[];
};
type Snapshot = {
  fingerprint: string;
  sources: Source[];
  members: { id: string; name: string }[];
  planning: {
    goals: unknown[];
    iterations: unknown[];
    milestones: unknown[];
    actions: unknown[];
  };
};
export function ProjectAssistant({
  project,
  onOpen,
}: {
  project: any;
  onOpen: (id: string) => void;
}) {
  const query = useData(
    ['projectAssistant', project.id],
    '/projects/' + project.id + '/assistant',
    true,
    30000,
  );
  const snapshot = query.data as Snapshot | undefined;
  const [goal, setGoal] = useState(
    '识别当前阻塞与交付风险，给出团队下一步行动和验收建议',
  );
  const [report, setReport] = useState<{
    result: ProjectPlan;
    fingerprint: string;
    generatedAt: string;
    model: string;
    goal: string;
    sources: Source[];
    members: Snapshot['members'];
    requestKey: string;
  }>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [converted, setConverted] = useState<string[]>([]);
  const stale = !!report && report.fingerprint !== snapshot?.fingerprint;
  const owner = (source: Source, members = snapshot?.members || []) =>
    source.handlerIds
      .map((id) => members.find((m) => m.id === id)?.name || '待核对成员')
      .join('、') || '待分配';
  async function generate() {
    setBusy(true);
    setError('');
    try {
      const current = await query.refetch();
      if (!current.data || current.error)
        throw current.error || new Error('推进依据读取失败');
      const data = await api(
        '/projects/' + project.id + '/assistant/run',
        'POST',
        { goal, fingerprint: current.data.fingerprint },
      );
      setReport({
        ...data,
        goal,
        sources: current.data.sources,
        members: current.data.members,
        requestKey: createClientId(),
      });
      setSaved(false);
      setConverted([]);
      void query.refetch();
    } catch (e: any) {
      setError(e.message || '生成失败，请重试');
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!report) return;
    setBusy(true);
    setError('');
    try {
      await api('/projects/' + project.id + '/assistant/save', 'POST', {
        result: report.result,
        goal: report.goal,
        fingerprint: report.fingerprint,
        requestKey: report.requestKey,
      });
      setSaved(true);
      void client.invalidateQueries({ queryKey: ['documents'] });
      void client.invalidateQueries({ queryKey: ['taskResources'] });
      void client.invalidateQueries({ queryKey: ['relatedDocuments'] });
    } catch (e: any) {
      setError(e.message || '保存失败，请重试');
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function convert(a: ProjectPlan['actions'][number], version: number) {
    setBusy(true);
    setError('');
    try {
      await api('/projects/' + project.id + '/actions', 'POST', {
        taskId: a.taskId,
        expectedTaskVersion: version,
        title: a.action,
        acceptance: a.acceptance,
        evidence: a.evidence,
        planFingerprint: report?.fingerprint,
      });
      setConverted((values) => [...values, a.taskId]);
      void client.invalidateQueries({
        queryKey: ['projectProgress', project.id],
      });
      void client.invalidateQueries({ queryKey: ['projectGoals', project.id] });
      void query.refetch();
    } catch (e: any) {
      setError(e.message || '转入失败，请重试');
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function adopt() {
    if (!report) return;
    setBusy(true);
    setError('');
    try {
      await api('/projects/' + project.id + '/actions/adopt', 'POST', {
        planFingerprint: report.fingerprint,
        requestKey: report.requestKey,
        actions: report.result.actions.map((a) => ({
          taskId: a.taskId,
          expectedTaskVersion: report.sources.find((s) => s.id === a.taskId)!
            .version,
          title: a.action,
          acceptance: a.acceptance,
          evidence: a.evidence,
        })),
      });
      setConverted(report.result.actions.map((a) => a.taskId));
      void client.invalidateQueries({
        queryKey: ['projectProgress', project.id],
      });
      void client.invalidateQueries({ queryKey: ['projectGoals', project.id] });
      void query.refetch();
    } catch (e: any) {
      setError(e.message || '批量采纳失败，未完成的请求可重试');
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const content = [
      '# 项目推进行动草稿',
      '',
      project.name,
      '生成时间：' + report.generatedAt,
      '模型：' + report.model,
      '目标：' + report.goal,
      '依据指纹：' + report.fingerprint,
      '> AI建议，待团队核对；当前处理人不是新增任务指派，本文不代表已执行、测试通过或完成验收。',
      '',
      report.result.summary,
      ...report.result.actions.flatMap((a) => {
        const source = report.sources.find((s) => s.id === a.taskId)!;
        return [
          '',
          '## CF-' + source.number + ' ' + source.title,
          '需求版本：' + source.version,
          '当前处理人：' + owner(source, report.members),
          '建议优先级：' + a.priority,
          '行动：' + a.action,
          '建议验收：' + a.acceptance,
          '依据原文：' + a.evidence,
        ];
      }),
      '',
      '## 待确认事项',
      ...report.result.questions.map((q) => '- ' + q),
    ].join('\n');
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'CoFlow-项目推进草稿.md';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Card title="AI 项目推进助手" className="project-assistant">
      <p className="muted">
        基于需求、目标、迭代、里程碑和已有行动生成建议。生成时会将这些项目摘要及行动成果说明发送至个人设置中配置的
        DeepSeek 服务。
      </p>
      {snapshot?.planning && (
        <p className="muted">
          规划依据：{snapshot.planning.goals.length} 项目标、
          {snapshot.planning.iterations.length} 个迭代、
          {snapshot.planning.milestones.length} 个里程碑、
          {snapshot.planning.actions.length}{' '}
          项行动。采纳前可先保存草稿；采纳后请重新生成后续建议。
        </p>
      )}
      {query.error ? (
        <Alert
          type="error"
          message="推进依据读取失败"
          description={(query.error as Error).message}
          action={<Button onClick={() => query.refetch()}>重试读取</Button>}
        />
      ) : (
        <>
          <List
            loading={query.isPending}
            dataSource={(snapshot?.sources || [])
              .filter((s) => s.signals.length)
              .slice(0, 8)}
            locale={{
              emptyText: (
                <Empty
                  description={
                    snapshot?.sources.length
                      ? '未发现规则可识别的交付缺口，可生成进一步建议'
                      : '暂无未完成需求'
                  }
                />
              ),
            }}
            renderItem={(s) => (
              <List.Item
                actions={[
                  <Button key="open" onClick={() => onOpen(s.id)}>
                    查看需求
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={'CF-' + s.number + ' ' + s.title}
                  description={
                    <>
                      <span>当前处理人：{owner(s)}</span>
                      <div>
                        {s.signals.map((signal) => (
                          <Tag color="orange" key={signal}>
                            {signal}
                          </Tag>
                        ))}
                      </div>
                    </>
                  }
                />
              </List.Item>
            )}
          />
          <p className="muted">
            依据共 {snapshot?.sources.length ?? '—'}{' '}
            项未完成需求；风险清单最多展示8项，生成覆盖全部依据。
          </p>
        </>
      )}
      <label htmlFor={'assistant-goal-' + project.id}>本次推进目标</label>
      <Input.TextArea
        id={'assistant-goal-' + project.id}
        value={goal}
        maxLength={2000}
        rows={2}
        disabled={busy}
        onChange={(e) => setGoal(e.target.value)}
      />
      <Space wrap style={{ marginTop: 12, marginBottom: 12 }}>
        <Button
          type="primary"
          loading={busy}
          disabled={
            !!project.archivedAt ||
            !snapshot?.sources.length ||
            !goal.trim() ||
            !!query.error
          }
          onClick={generate}
        >
          生成推进计划
        </Button>
        <Button disabled={busy} onClick={() => query.refetch()}>
          刷新推进依据
        </Button>
        {report && (
          <Button onClick={download} disabled={stale || !!query.error || busy}>
            导出行动草稿
          </Button>
        )}
        {report && (
          <Button
            disabled={
              stale ||
              !!query.error ||
              busy ||
              !!project.archivedAt ||
              converted.length > 0
            }
            onClick={adopt}
          >
            将全部建议转为行动
          </Button>
        )}
        {report && (
          <Button
            onClick={save}
            disabled={
              saved || stale || !!query.error || busy || !!project.archivedAt
            }
          >
            {saved ? '已保存到项目文档' : '保存到项目文档'}
          </Button>
        )}
      </Space>
      {!!project.archivedAt && (
        <Alert type="info" message="归档项目只读，无法生成新计划" />
      )}
      {error && <Alert type="error" message={error} />}
      {saved && (
        <Alert
          type="success"
          message="行动草稿已保存到项目文档，并关联对应需求；可进入文档共同核对。"
        />
      )}
      {report && (
        <>
          {(stale || query.error) && (
            <Alert
              type="warning"
              message="项目依据已变化或无法核对，以下仅供历史参考，请重新生成"
            />
          )}
          <Typography.Paragraph>{report.result.summary}</Typography.Paragraph>
          <p className="muted">
            生成于{' '}
            {new Date(report.generatedAt).toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
            })}
            （北京时间） · AI 建议待核对
          </p>
          <List
            dataSource={report.result.actions}
            renderItem={(a) => {
              const source = report.sources.find((s) => s.id === a.taskId)!;
              return (
                <List.Item>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Space wrap>
                      <Tag color={a.priority === 'HIGH' ? 'orange' : 'blue'}>
                        {a.priority === 'HIGH' ? '优先推进' : '正常推进'}
                      </Tag>
                      <Button type="link" onClick={() => onOpen(a.taskId)}>
                        {'CF-' + source.number + ' ' + source.title}
                      </Button>
                    </Space>
                    <p>
                      当前处理人：{owner(source, report.members)} · 需求版本{' '}
                      {source.version}
                    </p>
                    <p>{a.action}</p>
                    <p>
                      <strong>建议验收：</strong>
                      {a.acceptance}
                    </p>
                    <blockquote>依据：{a.evidence}</blockquote>
                    <Button
                      onClick={() => convert(a, source.version)}
                      disabled={
                        stale ||
                        !!query.error ||
                        busy ||
                        !!project.archivedAt ||
                        converted.includes(a.taskId)
                      }
                    >
                      {converted.includes(a.taskId) ? '已转为行动' : '转为行动'}
                    </Button>
                  </div>
                </List.Item>
              );
            }}
          />
          {!!report.result.questions.length && (
            <>
              <h3>待团队确认</h3>
              <ul>
                {report.result.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}
