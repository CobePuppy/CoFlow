import { isOverdue } from '../../../../packages/contracts/deadline.js';
import { workflowLabel } from '../../../../packages/contracts/workflow.js';
import { useState } from 'react';
import { edition } from '../edition.js';
import { Button, Card, Empty, Segmented, Tag } from 'antd';
import { labels, type Task } from '../../../../packages/contracts/index.js';

export function WorkOverview({ data, onNavigate }: any) {
  const [scope, setScope] = useState('pending');
  const todos: Task[] = [...data.todos].sort((a: Task, b: Task) =>
    (a.data.dueAt || '9999').localeCompare(b.data.dueAt || '9999'),
  );
  const blocked = (t: Task) => t.data.blocks.some((b) => !b.end);
  const overdue = (t: Task) => isOverdue(t.data.dueAt);
  const risks = todos.filter((t) => blocked(t) || overdue(t));
  const pending = todos.filter((t) => !blocked(t));
  const items =
    scope === 'blocked'
      ? todos.filter(blocked)
      : scope === 'overdue'
        ? todos.filter(overdue)
        : pending;
  const open = (t: Task) =>
    onNavigate({ project: t.projectId, task: t.id, view: 'todos' }, true);
  return (
    <>
      <div className="work-overview-heading">
        <div>
          <p className="muted">先处理待办，再关注阻塞与交付风险。</p>
        </div>
        <Tag>当前团队 · 我的待办</Tag>
      </div>
      <div className="work-stat-grid">
        {[
          ['pending', '待我推进', pending.length],
          ['all', '待我处理总数', todos.length],
          ['blocked', '阻塞', todos.filter(blocked).length],
          ['overdue', '逾期', todos.filter(overdue).length],
        ].map(([key, label, value]) => (
          <button
            key={key}
            className={`work-stat ${scope === key ? 'selected' : ''}`}
            onClick={() => setScope(String(key))}
            aria-pressed={scope === key}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      <div className="work-focus-grid">
        <Card
          title="待我推进"
          extra={
            <Button
              type="text"
              onClick={() => onNavigate({ view: 'todos', task: null }, true)}
            >
              查看全部 →
            </Button>
          }
        >
          <Segmented
            block
            value={scope}
            onChange={(v) => setScope(String(v))}
            options={[
              { label: '待推进', value: 'pending' },
              { label: '全部', value: 'all' },
              { label: '阻塞', value: 'blocked' },
              { label: '逾期', value: 'overdue' },
            ]}
          />
          <div className="work-task-grid">
            {(scope === 'all' ? todos : items).slice(0, 6).map((t) => (
              <button
                className="work-task-card"
                key={t.id}
                onClick={() => open(t)}
              >
                <div>
                  <Tag>{t.data.priority}</Tag>
                  <Tag color={edition.primary}>{workflowLabel(t)}</Tag>
                </div>
                <strong>{t.data.title}</strong>
                <small>
                  {data.projects.find((p: any) => p.id === t.projectId)?.name ||
                    '团队项目'}
                </small>
                <footer>
                  {blocked(t) ? '存在阻塞' : '等待本阶段处理'}
                  <span>{t.data.dueAt?.slice(0, 10) || '未设截止日期'}</span>
                </footer>
              </button>
            ))}
          </div>
          {!(scope === 'all' ? todos : items).length && (
            <Empty description="当前分类暂无待办" />
          )}
        </Card>
        <Card title="风险提醒">
          <p className="muted">显示需要我处理的阻塞和逾期需求。</p>
          {risks.slice(0, 6).map((t) => (
            <button key={t.id} className="work-risk" onClick={() => open(t)}>
              <strong>{t.data.title}</strong>
              <div>
                {blocked(t) && <Tag color="red">阻塞</Tag>}
                {overdue(t) && (
                  <Tag color="orange">逾期 · {t.data.dueAt?.slice(0, 10)}</Tag>
                )}
              </div>
              {blocked(t) && (
                <small>{t.data.blocks.find((b) => !b.end)?.reason}</small>
              )}
            </button>
          ))}
          {!risks.length && <Empty description="暂无阻塞或逾期待办" />}
        </Card>
      </div>
    </>
  );
}
