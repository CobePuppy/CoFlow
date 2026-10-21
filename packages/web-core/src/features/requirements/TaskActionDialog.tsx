import { useBrowserDraft } from '../../shared/lib/useBrowserDraft.js';
import { DraftRecovery } from '../../shared/ui/DraftRecovery.js';
import { Checkbox } from 'antd';

import { invalidateTaskQueries } from '../../shared/api/query-invalidation.js';
import { materialKindForAction } from '@coflow/contracts/material-import.js';
import FileImport from '../documents/components/FileImport.js';

import {
  AttachmentPanel,
  stageForStatus,
} from '../documents/components/AttachmentPanel.js';

import { HandoffPreview } from './components/HandoffPreview.js';

import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
} from 'antd';

import { type Member } from '@coflow/contracts/index.js';

import { api } from '../../shared/api/runtime.js';
import { actionLabels, actionFields } from './model/action-ui.js';

export function TaskActionDialog({
  setEditing,
  actions,
  begin,
  action,
  t,
  setAction,
  actionForm,
  busy,
  setBusy,
  run,
  people,
  id,
  user,
  importSource,
  setImportSource,
  actionError,
  setActionError,
  conflict,
  setConflict,
  readiness,
  q,
}: any) {
  const browserDraft = useBrowserDraft(
    [user.id, t.workspaceId, t.projectId, 'solution', id],
    action === 'SUBMIT_SOLUTION',
    t.version,
    ['body', 'scope', 'effort', 'risk', 'start', 'end'],
  );
  const d = t.data;
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  return (
    <Modal
      open
      title={actionLabels[action] || '提出需求变更'}
      className="requirement-transition"
      width={720}
      onCancel={() => setAction('')}
      footer={null}
      destroyOnHidden
    >
      <HandoffPreview
        task={t}
        action={action}
        members={people.data || []}
        userId={user.id}
      />
      <AttachmentPanel
        taskId={id}
        stage={stageForStatus[t.status] || 'GENERAL'}
        readOnly={t.readOnly}
        title="本阶段附件"
        onParse={materialKindForAction(action) ? setImportSource : undefined}
      />
      {action === 'SUBMIT_SOLUTION' && (
        <DraftRecovery
          draft={browserDraft}
          disabled={busy}
          onRestore={(v) => actionForm.setFieldsValue(v)}
        />
      )}
      <Form
        form={actionForm}
        disabled={busy}
        onValuesChange={() =>
          browserDraft.save(actionForm.getFieldsValue(true))
        }
        layout="vertical"
        onFinish={async (v) => {
          const payload = { ...v };
          if (payload.defectIds)
            payload.defectIds = payload.defectIds
              .split(',')
              .map((x: string) => x.trim())
              .filter(Boolean);
          if (payload.criteria)
            payload.criteria = payload.criteria.split('\n').filter(Boolean);
          if (payload.effort) payload.effort = Number(payload.effort);
          if (action === 'PROPOSE_CHANGE') {
            setBusy(true);
            try {
              await api(`/tasks/${id}/requirement-changes`, 'POST', {
                ...payload,
                expectedVersion: t.version,
              });
              setAction('');
              invalidateTaskQueries(qc);
            } catch (e) {
              setActionError((e as Error).message);
            } finally {
              setBusy(false);
            }
          } else if (await run(payload)) browserDraft.clear();
        }}
      >
        {materialKindForAction(action) && (
          <FileImport
            key={action}
            kind={materialKindForAction(action)!}
            source={importSource}
            buttonLabel="从文件解析填入"
            onApply={(fields) => {
              actionForm.setFieldsValue(fields);
              browserDraft.save(actionForm.getFieldsValue(true));
            }}
          />
        )}
        {action === 'SUBMIT_REQUIREMENT' && readiness && (
          <Alert
            style={{ marginBottom: 16 }}
            type={readiness.ready ? 'success' : 'warning'}
            showIcon
            message={
              readiness.ready
                ? d?.workflow === 'SIMPLE'
                  ? '已具备提交条件，确认后进入待办'
                  : '已具备提交条件，确认后进入待出方案'
                : '请先补齐提交资料'
            }
            description={
              <div>
                {[
                  ...readiness.content,
                  ...readiness.assignment,
                  ...(readiness.blocked ? ['请先解除当前阻塞'] : []),
                ].map((x) => (
                  <p key={x}>{x}</p>
                ))}
                {!readiness.ready && (
                  <Space wrap>
                    <Button
                      onClick={() => {
                        setAction('');
                        setEditing(true);
                      }}
                    >
                      编辑并补全需求
                    </Button>
                    {actions.includes('TRANSFER') && (
                      <Button onClick={() => begin('TRANSFER')}>
                        调整责任分工
                      </Button>
                    )}
                  </Space>
                )}
              </div>
            }
          />
        )}
        {actionError && (
          <Alert
            type="error"
            message={actionError}
            style={{ marginBottom: 16 }}
          />
        )}
        {conflict && (
          <Space className="conflict-controls">
            <Button
              onClick={() =>
                navigator.clipboard
                  .writeText(
                    JSON.stringify(actionForm.getFieldsValue(), null, 2),
                  )
                  .then(() => message.success('输入已复制'))
                  .catch(() =>
                    message.error('无法访问剪贴板，请手动复制表单内容'),
                  )
              }
            >
              复制当前输入
            </Button>
            <Button loading={q.isFetching} onClick={() => q.refetch()}>
              重新加载状态
            </Button>
          </Space>
        )}
        {(
          actionFields[
            action === 'PROPOSE_CHANGE' ? 'APPLY_REQUIREMENT_CHANGE' : action
          ] ||
          ([
            'REJECT_SOLUTION',
            'RETURN_REQUIREMENT',
            'BLOCK',
            'UNBLOCK',
            'CANCEL',
          ].includes(action)
            ? [['reason', '操作原因']]
            : [])
        )
          .filter(([k]) => !(d?.workflow === 'SIMPLE' && k === 'target'))
          .map(([k, l, type]) => (
            <Form.Item key={k} name={k} label={l} rules={[{ required: true }]}>
              {type === 'target' ? (
                <Select
                  options={[
                    { value: 'DEVELOPING', label: '开发中' },
                    { value: 'READY_FOR_TEST', label: '待测试（新轮次）' },
                  ]}
                />
              ) : type === 'date' || type === 'number' ? (
                <Input type={type} />
              ) : (
                <Input.TextArea
                  rows={k === 'body' || k === 'description' ? 5 : 2}
                />
              )}
            </Form.Item>
          ))}
        {action === 'TRANSFER' && (
          <>
            {[
              'productId',
              'engineerId',
              'productReviewerId',
              'qaReviewerId',
              'testerId',
            ].map((k, i) => (
              <Form.Item
                key={k}
                name={k}
                label={
                  [
                    '产品负责人',
                    '研发负责人',
                    '产品评估人',
                    '测试评估人',
                    '测试负责人',
                  ][i]
                }
              >
                <Select
                  allowClear
                  options={people.data?.map((m: Member) => ({
                    value: m.id,
                    label: `${m.name} (${m.roles.join('/')})`,
                  }))}
                />
              </Form.Item>
            ))}
          </>
        )}
        {action === 'ACCEPT' && (
          <Form.Item
            name="checks"
            rules={[
              {
                validator: (_, v) =>
                  v?.length === d?.criteria.length && v.every(Boolean)
                    ? Promise.resolve()
                    : Promise.reject(new Error('请确认全部验收标准')),
              },
            ]}
          >
            <CriteriaChecks criteria={d?.criteria || []} />
          </Form.Item>
        )}
        <Button
          type="primary"
          htmlType="submit"
          loading={busy}
          disabled={action === 'SUBMIT_REQUIREMENT' && !readiness?.ready}
        >
          {conflict
            ? '按最新状态重新提交'
            : '确认' + (actionLabels[action] || '提出变更')}
        </Button>
        {action === 'SUBMIT_SOLUTION' && (
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const payload = actionForm.getFieldsValue();
                if (payload.effort) payload.effort = Number(payload.effort);
                await api(`/tasks/${id}/solutions`, 'POST', {
                  expectedVersion: t.version,
                  payload,
                });
                browserDraft.clear();
                message.success('方案草稿已保存');
                invalidateTaskQueries(qc);
              } catch (e) {
                setActionError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存方案草稿
          </Button>
        )}
        <p className="muted small">
          操作将记录至审计时间线。版本冲突时请保留输入并刷新。
        </p>
      </Form>
    </Modal>
  );
}

function CriteriaChecks({ criteria, value = [], onChange }: any) {
  return (
    <div>
      {criteria.map((c: string, i: number) => (
        <p key={i}>
          <Checkbox
            checked={!!value[i]}
            onChange={(e) => {
              const a = criteria.map((_: any, j: number) =>
                j === i ? e.target.checked : !!value[j],
              );
              onChange(a);
            }}
          >
            {c}
          </Checkbox>
        </p>
      ))}
    </div>
  );
}
