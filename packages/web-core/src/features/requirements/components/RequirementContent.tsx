import { useBrowserDraft } from '../../../shared/lib/useBrowserDraft.js';
import { DraftRecovery } from '../../../shared/ui/DraftRecovery.js';
import { useState } from 'react';
import { Alert, App, Button, Input, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/runtime.js';
import { FileImport } from '../../../app/pages.js';
import { Markdown } from '../../../shared/ui/Markdown.js';
import { useUnsavedChanges } from '../../../shared/lib/unsaved.js';
import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';

const fields = [
  ['title', '需求标题'],
  ['goal', '目标'],
  ['background', '背景'],
  ['description', '范围与需求说明'],
  ['criteria', '验收标准'],
] as const;
export function RequirementContent({ task, user, onChangeRequest }: any) {
  const editable =
    task.status === 'DRAFT' &&
    !task.readOnly &&
    task.data.productId === user.id;
  const [editing, setEditing] = useState(''),
    [draft, setDraft] = useState<Record<string, any>>({}),
    [version, setVersion] = useState(task.version),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const browserDraft = useBrowserDraft(
    [user.id, task.workspaceId, task.projectId, 'body', task.id],
    editable,
    task.version,
    fields.map(([key]) => key),
  );
  const qc = useQueryClient();
  useUnsavedChanges(!!editing);
  const { message } = App.useApp();
  function start(field: string) {
    if (editing) return;
    setVersion(task.version);
    setDraft({
      [field]:
        field === 'criteria' ? task.data.criteria.join('\n') : task.data[field],
    });
    setEditing(field);
    setError('');
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload = Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [
          key,
          key === 'criteria'
            ? String(value)
                .split('\n')
                .map((x) => x.trim())
                .filter(Boolean)
            : value,
        ]),
      );
      await api('/tasks/' + task.id, 'PATCH', {
        ...payload,
        expectedVersion: version,
      });
      browserDraft.clear();
      setEditing('');
      setDraft({});
      await invalidateTaskQueries(qc);
      message.success('需求内容已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const controls = (
    <Space wrap>
      <Button type="primary" loading={busy} onClick={save}>
        保存正文修改
      </Button>
      <Button
        disabled={busy}
        onClick={() => {
          setEditing('');
          setError('');
        }}
      >
        取消正文修改
      </Button>
    </Space>
  );
  return (
    <section className="requirement-content">
      <div className="requirement-content-tools">
        {editable && !editing ? (
          <>
            <Button
              onClick={() => {
                setVersion(task.version);
                setDraft(
                  Object.fromEntries(
                    fields.map(([key]) => [
                      key,
                      key === 'criteria'
                        ? task.data.criteria.join('\n')
                        : task.data[key],
                    ]),
                  ),
                );
                setEditing('import');
                setError('');
              }}
            >
              编辑内容
            </Button>
            <FileImport
              kind="requirement"
              onApply={(values: any) => {
                const next = Object.fromEntries(
                  fields
                    .filter(([key]) => values[key] !== undefined)
                    .map(([key]) => [
                      key,
                      key === 'criteria' ? values[key].join('\n') : values[key],
                    ]),
                );
                setDraft(next);
                browserDraft.save(next);
                setVersion(task.version);
                setEditing('import');
                setError('');
              }}
            />
            <span className="muted">点击下方内容即可编辑，保存后生效。</span>
          </>
        ) : !editable ? (
          <Alert
            type="info"
            message={
              task.readOnly
                ? '项目已归档，正文只读'
                : task.status !== 'DRAFT'
                  ? '需求已提交，修改请走变更流程，保留已提交版本'
                  : '仅产品负责人可以编辑当前草稿'
            }
            action={
              onChangeRequest ? (
                <Button onClick={onChangeRequest}>发起内容变更</Button>
              ) : undefined
            }
          />
        ) : (
          <span className="muted">正在编辑正文，保存或取消后可切换字段。</span>
        )}
      </div>
      {editable && (
        <DraftRecovery
          draft={browserDraft}
          disabled={busy}
          onRestore={(values) => {
            setDraft(values);
            setVersion(task.version);
            setEditing('import');
            setError('');
          }}
        />
      )}
      {error && (
        <Alert
          type="error"
          message={error}
          description="输入已保留。若版本冲突，请复制保留文本后刷新，再核对修改。"
        />
      )}
      {fields.map(([key, label]) => {
        const active =
          editing === key || (editing === 'import' && key in draft);
        const value = task.data[key];
        return (
          <section key={key} className="requirement-content-field">
            <h3>
              {label}
              {editable && !active && !editing && (
                <span className="inline-edit-hint">点击内容编辑</span>
              )}
            </h3>
            {active ? (
              <div>
                <Input.TextArea
                  autoFocus={editing !== 'import'}
                  aria-label={'编辑' + label}
                  value={draft[key]}
                  rows={key === 'title' ? 2 : key === 'criteria' ? 5 : 6}
                  maxLength={
                    key === 'title'
                      ? 200
                      : key === 'description'
                        ? 100000
                        : key === 'criteria'
                          ? 200000
                          : 10000
                  }
                  disabled={busy}
                  onChange={(e) => {
                    const next = { ...draft, [key]: e.target.value };
                    setDraft(next);
                    browserDraft.save(next);
                  }}
                />
                {key === 'criteria' && (
                  <p className="muted">每行一项可验证的验收标准。</p>
                )}
                {editing !== 'import' && controls}
              </div>
            ) : (
              <div
                className={
                  editable && !editing ? 'editable-requirement-content' : ''
                }
                role={editable && !editing ? 'button' : undefined}
                tabIndex={editable && !editing ? 0 : undefined}
                aria-label={editable && !editing ? '编辑' + label : undefined}
                onClick={(e) => {
                  if (
                    editable &&
                    !editing &&
                    !(e.target as HTMLElement).closest('a,button')
                  )
                    start(key);
                }}
                onKeyDown={(e) => {
                  if (
                    editable &&
                    !editing &&
                    e.target === e.currentTarget &&
                    (e.key === 'Enter' || e.key === ' ')
                  ) {
                    e.preventDefault();
                    start(key);
                  }
                }}
              >
                {key === 'criteria' ? (
                  value.length ? (
                    <ol className="requirement-criteria">
                      {value.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">
                      暂未填写验收标准{editable ? '，点击补充。' : '。'}
                    </p>
                  )
                ) : (
                  <Markdown>
                    {value ||
                      '暂未填写' + label + (editable ? '，点击补充。' : '。')}
                  </Markdown>
                )}
              </div>
            )}
          </section>
        );
      })}
      {editing === 'import' && controls}
    </section>
  );
}
