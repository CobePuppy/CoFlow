import { useEffect, useState } from 'react';
import { App, Button, Form, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { TaskActionDialog } from '../TaskActionDialog.js';
import {
  forwardActions,
  requirementReadiness,
} from '../model/transition-readiness.js';
import { actionLabels } from '../model/action-ui.js';
import { QuickRequirementActions } from './QuickRequirementActions.js';
import { api } from '../../../shared/api/runtime.js';
import { ApiError } from '../../../shared/api/api-response.js';
import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';
import { createClientId } from '../../../shared/lib/client-id.js';
import { useUnsavedChanges } from '../../../shared/lib/unsaved.js';

// Use the same validated forms and action endpoint as the full detail view.
export function PreviewActions({
  task,
  members,
  user,
  query,
  onOpen,
  onBusyChange,
}: any) {
  const [action, setActionState] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [importSource, setImportSource] = useState<any>();
  const [requestKey, setRequestKey] = useState('');
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  useUnsavedChanges(!!action);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const actions: string[] = task.allowedActions || [];
  const primary = forwardActions.find((a) => actions.includes(a));
  const readiness = requirementReadiness(
    task,
    members.map((m: any) => m.id),
  );
  const setAction = (value: string) => {
    if (busy) return;
    setActionState(value);
    onBusyChange(!!value);
  };
  const begin = (value: string) => {
    form.resetFields();
    setError('');
    setConflict(false);
    setImportSource(undefined);
    if (value === 'SUBMIT_SOLUTION' && task.data.solutionDraft)
      form.setFieldsValue(task.data.solutionDraft);
    setRequestKey(createClientId());
    setAction(value);
  };
  async function run(payload: any) {
    setBusy(true);
    setError('');
    try {
      await api(
        `/tasks/${task.id}/actions`,
        'POST',
        {
          action,
          expectedVersion: task.version,
          payload,
        },
        requestKey,
      );
      setActionState('');
      onBusyChange(false);
      message.success(`已${actionLabels[action] || '更新需求'}`);
      await invalidateTaskQueries(qc);
      return true;
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setRequestKey(createClientId());
      }
      await query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Space wrap className="preview-actions">
        {!task.readOnly && primary && (
          <Button
            type="primary"
            onClick={() => begin(primary)}
            disabled={
              readiness.blocked ||
              (primary === 'SUBMIT_REQUIREMENT' && !readiness.ready)
            }
          >
            {actionLabels[primary]}
          </Button>
        )}
        {!task.readOnly && actions.includes('UNBLOCK') && (
          <Button onClick={() => begin('UNBLOCK')}>解除阻塞</Button>
        )}
        <QuickRequirementActions
          task={task}
          userId={user.id}
          admin={task.canManage}
          readOnly={task.readOnly}
          members={members}
        />
      </Space>
      {primary === 'SUBMIT_REQUIREMENT' && !readiness.ready && (
        <p className="next-step-warning">
          提交前需补齐：
          {[...readiness.content, ...readiness.assignment].join('、')}
        </p>
      )}
      {action && (
        <TaskActionDialog
          t={task}
          id={task.id}
          user={user}
          people={{ data: members }}
          actions={actions}
          action={action}
          setAction={setAction}
          begin={begin}
          actionForm={form}
          busy={busy}
          setBusy={setBusy}
          run={run}
          importSource={importSource}
          setImportSource={setImportSource}
          actionError={error}
          setActionError={setError}
          conflict={conflict}
          setConflict={setConflict}
          readiness={readiness}
          q={query}
          setEditing={() => onOpen(task.id)}
        />
      )}
    </>
  );
}
