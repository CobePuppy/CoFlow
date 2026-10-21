import { useUnsavedChanges } from '../../../shared/lib/unsaved.js';
import { useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Alert } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { Member, Task } from '@coflow/contracts/index.js';
import type { Discussion } from '@coflow/contracts/discussion.js';
import { isOverdue } from '@coflow/contracts/deadline.js';
import { api } from '../../../shared/api/runtime.js';
import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';
export function QuestionAssignment({
  task,
  question,
  members,
  userId,
}: {
  task: Task & { readOnly: boolean };
  question: Discussion;
  members: Member[];
  userId: string;
}) {
  const [open, setOpen] = useState(false),
    [assignee, setAssignee] = useState<string | null>(null),
    [due, setDue] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { message } = App.useApp(),
    qc = useQueryClient();
  useUnsavedChanges(open && !!reason);
  const can =
    question.by === userId ||
    question.assigneeId === userId ||
    task.data.productId === userId;
  const person = members.find((m) => m.id === question.assigneeId);
  return (
    <>
      <p>
        跟进人：
        {question.assigneeId
          ? person?.name || '已移出项目，请调整负责人'
          : '待分配'}{' '}
        · 截止：{question.dueAt || '未设置'}
        {!question.resolved && isOverdue(question.dueAt || undefined) && (
          <strong style={{ color: '#cf1322' }}> · 已逾期</strong>
        )}
      </p>
      {question.checkedVersion !== undefined &&
        question.checkedVersion !== task.data.requirementVersion && (
          <Alert
            type="warning"
            message="此问题或结论对应旧版需求，需结合当前正式需求重新核对"
          />
        )}
      {question.assignments?.map((a, i) => (
        <p className="muted" key={i}>
          {a.name} · {new Date(a.at).toLocaleString('zh-CN')} · 跟进人：
          {a.assigneeId
            ? members.find((m) => m.id === a.assigneeId)?.name || '历史成员'
            : '待分配'}{' '}
          · 截止：{a.dueAt || '未设置'} · {a.reason}
        </p>
      ))}
      {can && (
        <Button
          disabled={task.readOnly}
          onClick={() => {
            setAssignee(question.assigneeId || null);
            setDue(question.dueAt || '');
            setReason('');
            setError('');
            setOpen(true);
          }}
        >
          调整跟进安排
        </Button>
      )}
      <Modal
        title="调整跟进安排"
        open={open}
        okText="保存跟进安排"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{
          disabled: !reason.trim() || busy,
          'aria-label': '保存跟进安排',
        }}
        onCancel={() => !busy && setOpen(false)}
        onOk={async () => {
          setBusy(true);
          setError('');
          try {
            await api(
              `/tasks/${task.id}/comments/${question.id}/assignment`,
              'PATCH',
              {
                expectedVersion: task.version,
                assigneeId: assignee,
                dueAt: due || null,
                reason,
              },
            );
            setOpen(false);
            message.success('跟进安排已更新');
            invalidateTaskQueries(qc);
          } catch (e) {
            setError((e as Error).message);
            invalidateTaskQueries(qc);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <label>跟进人</label>
          <Select
            aria-label="调整问题跟进人"
            allowClear
            value={assignee}
            onChange={(v) => setAssignee(v || null)}
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            style={{ width: '100%' }}
            placeholder="待分配"
          />
          <label htmlFor="question-due">截止日期</label>
          <Input
            id="question-due"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <label htmlFor="question-reason">调整原因</label>
          <Input.TextArea
            id="question-reason"
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
          {error && <Alert type="error" message={error} />}
        </Space>
      </Modal>
    </>
  );
}
