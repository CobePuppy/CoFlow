import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Tooltip,
  Upload,
} from 'antd';
import { UploadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from '../runtime.js';

export const attachmentStages: Record<string, string> = {
  GENERAL: '补充附件',
  REQUIREMENT: '需求附件',
  SOLUTION: '方案附件',
  REVIEW: '评估附件',
  DEVELOPMENT: '开发交付附件',
  TESTING: '测试附件',
  ACCEPTANCE: '验收附件',
};
export const stageForStatus: Record<string, string> = {
  DRAFT: 'REQUIREMENT',
  SOLUTION_PENDING: 'SOLUTION',
  SOLUTION_REVIEW: 'REVIEW',
  READY_FOR_DEV: 'DEVELOPMENT',
  DEVELOPING: 'DEVELOPMENT',
  READY_FOR_TEST: 'TESTING',
  TESTING: 'TESTING',
  ACCEPTANCE_PENDING: 'ACCEPTANCE',
  CLOSED: 'ACCEPTANCE',
};

export function AttachmentPanel({
  taskId,
  stage,
  readOnly,
  title,
  search = '',
  onParse,
  parseUnavailableReason,
}: {
  taskId: string;
  stage?: string;
  readOnly?: boolean;
  title?: string;
  search?: string;
  onParse?: (attachment: { id: string; name: string }) => void;
  parseUnavailableReason?: string;
}) {
  const query = useData(
    ['attachments', taskId],
    `/tasks/${taskId}/attachments?includeDeleted=true`,
    !!taskId,
  );
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const items = (query.data || []).filter(
    (a: any) =>
      (!stage ||
        a.stage === stage ||
        (stage === 'REQUIREMENT' && a.stage === 'GENERAL')) &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
  async function change(id: string, restore = false) {
    setBusy(true);
    try {
      await api(
        `/attachments/${id}${restore ? '/restore' : ''}`,
        restore ? 'POST' : 'DELETE',
        {},
      );
      await qc.invalidateQueries({ queryKey: ['attachments', taskId] });
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
      await qc.invalidateQueries({ queryKey: ['libraryFiles'] });
      message.success(restore ? '附件已恢复' : '附件已移至已删除');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const row = (a: any) => (
    <div className="requirement-attachment" key={a.id}>
      {a.deletedAt ? (
        <span className="muted">{a.name}</span>
      ) : (
        <a href={`/api/v1/attachments/${a.id}/download`}>{a.name}</a>
      )}
      <Space wrap className="requirement-attachment-actions">
        {!stage && <Tag>{attachmentStages[a.stage] || '补充附件'}</Tag>}
        <small>{(a.size / 1024).toFixed(1)} KB</small>
        {!a.deletedAt &&
          /\.(txt|md|docx|pdf)$/i.test(a.name) &&
          (onParse || parseUnavailableReason) && (
            <Tooltip
              title={
                a.size > 8 * 1024 * 1024
                  ? '解析支持8MB以内文件，请拆分后导入'
                  : parseUnavailableReason
              }
            >
              <span>
                <Button
                  size="small"
                  disabled={
                    readOnly || busy || !onParse || a.size > 8 * 1024 * 1024
                  }
                  aria-label={`解析附件并填入：${a.name}`}
                  onClick={() => onParse?.({ id: a.id, name: a.name })}
                >
                  解析并填入
                </Button>
              </span>
            </Tooltip>
          )}
        {!a.deletedAt && (
          <Button
            size="small"
            type="primary"
            href={`/api/v1/attachments/${a.id}/download`}
            aria-label={`下载附件：${a.name}`}
          >
            下载
          </Button>
        )}
        {a.canDelete &&
          !readOnly &&
          (a.deletedAt ? (
            <Button
              size="small"
              disabled={busy}
              onClick={() => change(a.id, true)}
            >
              恢复
            </Button>
          ) : (
            <Popconfirm
              title="删除这个附件？"
              description="删除后可在已删除列表中恢复。"
              onConfirm={() => change(a.id)}
              okText="删除"
              cancelText="取消"
            >
              <Button danger size="small" disabled={busy}>
                删除
              </Button>
            </Popconfirm>
          ))}
      </Space>
    </div>
  );
  return (
    <section
      className="attachment-panel"
      aria-label={title || (stage ? attachmentStages[stage] : '全部附件')}
    >
      <div className="attachment-panel-heading">
        <strong>
          {title || (stage ? attachmentStages[stage] : '全部附件')}
        </strong>
        <Space>
          <Tooltip title="支持图片、PDF、TXT、Markdown、Word、Excel和ZIP，单个文件最大20MB；纯文本使用UTF-8。">
            <InfoCircleOutlined className="muted" aria-label="附件格式说明" />
          </Tooltip>
          <Upload
            showUploadList={false}
            disabled={readOnly || busy}
            customRequest={async (options) => {
              setBusy(true);
              try {
                const data = new FormData();
                data.append('file', options.file as File);
                data.append('stage', stage || 'GENERAL');
                await api(`/tasks/${taskId}/attachments`, 'POST', data);
                await qc.invalidateQueries({
                  queryKey: ['attachments', taskId],
                });
                await qc.invalidateQueries({ queryKey: ['task', taskId] });
                await qc.invalidateQueries({ queryKey: ['libraryFiles'] });
                options.onSuccess?.({});
                message.success('附件已上传');
              } catch (e) {
                message.error((e as Error).message);
                options.onError?.(e as Error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Button
              icon={<UploadOutlined />}
              loading={busy}
              disabled={readOnly}
            >
              上传附件
            </Button>
          </Upload>
        </Space>
      </div>
      {query.isPending && <Spin size="small" />}
      {query.error && (
        <Alert
          type="error"
          message={query.error.message}
          action={<Button onClick={() => query.refetch()}>重试</Button>}
        />
      )}
      {!query.isPending &&
        !query.error &&
        !items.some((a: any) => !a.deletedAt) && (
          <p className="muted attachment-empty">暂无附件</p>
        )}
      {items.filter((a: any) => !a.deletedAt).map(row)}
      {items.some((a: any) => a.deletedAt) && (
        <Collapse
          ghost
          items={[
            {
              key: 'deleted',
              label: `已删除（${items.filter((a: any) => a.deletedAt).length}）`,
              children: items.filter((a: any) => a.deletedAt).map(row),
            },
          ]}
        />
      )}
    </section>
  );
}
