import { Alert, Button, Input, Modal, Space } from 'antd';
import { useState } from 'react';
import type { useBrowserDraft } from '../lib/useBrowserDraft.js';
export function DraftRecovery({
  draft,
  onRestore,
  disabled = false,
  fieldLabels = {},
}: {
  draft: ReturnType<typeof useBrowserDraft>;
  disabled?: boolean;
  fieldLabels?: Record<string, string>;
  onRestore: (values: Record<string, string | number>) => void;
}) {
  const [view, setView] = useState(false);
  const labels: Record<string, string> = {
    title: '需求标题',
    background: '背景',
    goal: '目标',
    description: '需求描述',
    criteria: '验收标准',
    priority: '优先级',
    dueAt: '计划截止',
    body: '方案正文',
    scope: '影响范围',
    effort: '预计工作量',
    risk: '风险说明',
    start: '预计开始日期',
    end: '预计结束日期',
    ...fieldLabels,
  };
  return (
    <>
      <Alert
        style={{ marginBottom: 16 }}
        type={draft.candidate ? 'warning' : 'info'}
        message={
          draft.candidate
            ? '发现未完成的工作副本'
            : draft.notice ||
              '工作副本仅保存在当前浏览器，不会正式提交或同步其他设备'
        }
        description={
          draft.candidate ? (
            <>
              <p>
                {new Date(draft.candidate.at).toLocaleString()} ·{' '}
                {draft.conflict
                  ? '正式内容版本已变化，旧稿仅供核对，请复制需要的内容。'
                  : '恢复前请核对，恢复将替换当前编辑内容。'}
              </p>
              {draft.notice && <p role="status">{draft.notice}</p>}
              <Space wrap>
                <Button
                  disabled={disabled || draft.conflict}
                  onClick={() => {
                    const values = draft.restore();
                    if (values) onRestore(values);
                  }}
                >
                  恢复工作副本
                </Button>
                <Button disabled={disabled} onClick={() => setView(true)}>
                  查看工作副本
                </Button>
                <Button disabled={disabled} onClick={draft.discard}>
                  舍弃旧工作副本
                </Button>
              </Space>
            </>
          ) : undefined
        }
      />
      <Modal
        open={view}
        title="工作副本（仅供核对）"
        footer={null}
        onCancel={() => setView(false)}
      >
        <p>仅供核对和复制；负责人等协作分工请在表单中重新确认。</p>
        {Object.entries(draft.candidate?.values || {})
          .filter(([key]) => labels[key])
          .map(([key, value]) => (
            <div key={key}>
              <p>
                <strong>{labels[key]}</strong>
              </p>
              <Input.TextArea
                aria-label={'副本' + labels[key]}
                readOnly
                autoSize={{ minRows: 1, maxRows: 8 }}
                value={String(value)}
              />
            </div>
          ))}
      </Modal>
    </>
  );
}
