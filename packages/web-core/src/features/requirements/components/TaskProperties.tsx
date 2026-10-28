import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';
import { workflowLabel } from '@coflow/contracts/workflow.js';
import { edition } from '../../../app/edition.js';
import { createClientId } from '../../../shared/lib/client-id.js';
import { useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Input,
  Popover,
  Select,
  Tag,
  Tooltip,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  DownOutlined,
  ArrowRightOutlined,
  SendOutlined,
  StopOutlined,
  TeamOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { terminal, type Member, type Task } from '@coflow/contracts/index.js';

const owners = [
  ['productId', '产品负责人', ['PRODUCT']],
  ['engineerId', '研发负责人', ['ENGINEER']],
  ['testerId', '测试负责人', ['QA', 'OPS']],
  ['productReviewerId', '产品评估人', ['PRODUCT']],
  ['qaReviewerId', '测试评估人', ['QA']],
] as const;

export function TaskProperties({
  task,
  user,
  members,
  projectName,
  request,
  begin,
  actionLabels,
}: any) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const t = task as Task & {
    readOnly: boolean;
    editableFields?: string[];
    allowedActions: string[];
    handlerIds: string[];
  };
  const d = t.data;
  const [editing, setEditing] = useState('');
  const [value, setValue] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(t.version);
  const [key, setKey] = useState('');
  const [conflict, setConflict] = useState(false);
  const person = (id: string) =>
    members.find((m: Member) => m.id === id)?.name || '未指定';
  function start(field: string) {
    setEditing(field);
    setError('');
    setConflict(false);
    setVersion(t.version);
    setKey(createClientId());
    setValue(field === 'dueAt' ? d.dueAt?.slice(0, 10) : (d as any)[field]);
  }
  async function save(field: string, transfer: boolean) {
    if (conflict) return;
    if (transfer && !value) {
      setError('请选择项目成员');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (transfer)
        await request(
          `/tasks/${t.id}/actions`,
          'POST',
          {
            action: 'TRANSFER',
            expectedVersion: version,
            payload: { [field]: value },
          },
          key,
        );
      else
        await request(`/tasks/${t.id}/properties`, 'PATCH', {
          expectedVersion: version,
          [field]:
            field === 'dueAt'
              ? value
                ? new Date(value).toISOString()
                : null
              : value,
        });
      setEditing('');
      await invalidateTaskQueries(qc);
      message.success('已保存');
    } catch (e: any) {
      setError(e.message);
      if (e.status === 409) {
        setConflict(true);
        await qc.invalidateQueries({ queryKey: ['task', t.id] });
      }
    } finally {
      setBusy(false);
    }
  }
  function editor(
    field: string,
    label: string,
    content: React.ReactNode,
    control: React.ReactNode,
    editable: boolean,
    transfer = false,
    hint = '',
  ) {
    return (
      <Popover
        key={field}
        trigger="click"
        classNames={{ root: 'task-property-overlay' }}
        destroyOnHidden
        placement="leftTop"
        open={editing === field}
        onOpenChange={(visible) => {
          if (!visible && !busy)
            setEditing((current) => (current === field ? '' : current));
        }}
        content={
          <div className="property-popover">
            <div className="property-popover-heading">
              <span className="property-heading-icon">
                {transfer ? <TeamOutlined /> : <EditOutlined />}
              </span>
              <div>
                <strong>
                  {transfer ? '更换' : '修改'}
                  {label}
                </strong>
                <p>
                  {transfer
                    ? '从项目成员中选择，可兼任其他职责。'
                    : '确认选择后保存，或取消保留当前设置。'}
                </p>
              </div>
            </div>
            {control}
            {error && <Alert type="error" showIcon message={error} />}
            {conflict && (
              <Button
                block
                onClick={() => {
                  setVersion(t.version);
                  setKey(createClientId());
                  setConflict(false);
                  setError('');
                }}
              >
                核对最新状态后，使用当前选择继续
              </Button>
            )}
            <div className="property-popover-actions">
              <Button
                aria-label="取消"
                icon={<CloseOutlined />}
                disabled={busy}
                onClick={() => setEditing('')}
              >
                取消
              </Button>
              <Button
                aria-label="保存"
                type="primary"
                icon={<CheckOutlined />}
                loading={busy}
                disabled={conflict || (field !== 'dueAt' && !value)}
                onClick={() => save(field, transfer)}
              >
                保存
              </Button>
            </div>
          </div>
        }
      >
        <Tooltip
          title={
            editable
              ? `点击修改${label}`
              : hint ||
                (t.readOnly || terminal(t.status)
                  ? '当前需求仅可查看'
                  : '仅产品负责人可修改')
          }
        >
          <button
            className={`property-value ${editing === field ? 'is-open' : ''}`}
            aria-expanded={editing === field}
            type="button"
            aria-label={`修改${label}`}
            disabled={!editable || busy}
            onClick={() => start(field)}
          >
            {content}
            <EditOutlined />
          </button>
        </Tooltip>
      </Popover>
    );
  }
  const transitions = t.allowedActions.filter(
    (a: string) =>
      ![
        'TRANSFER',
        'BLOCK',
        'UNBLOCK',
        'PROPOSE_CHANGE',
        'APPLY_REQUIREMENT_CHANGE',
      ].includes(a),
  );
  return (
    <dl className="detail-facts editable-facts">
      <div>
        <dt>状态</dt>
        <dd>
          <Popover
            trigger="click"
            classNames={{ root: 'task-property-overlay' }}
            destroyOnHidden
            placement="leftTop"
            content={
              <div className="property-state-menu">
                <div className="property-popover-heading">
                  <span className="property-heading-icon">
                    <SendOutlined />
                  </span>
                  <div>
                    <strong>推进需求</strong>
                    <p>选择下一步，完成必要信息后提交。</p>
                  </div>
                </div>
                {transitions.map((a: string) => (
                  <button
                    key={a}
                    className={`property-action-option ${a === 'CANCEL' || a.startsWith('REJECT') || a === 'FAIL_TEST' ? 'danger' : ''}`}
                    aria-label={actionLabels[a]}
                    onClick={() => {
                      setEditing('');
                      begin(a);
                    }}
                  >
                    <span className="property-action-icon">
                      {a === 'CANCEL' ? (
                        <StopOutlined />
                      ) : a.startsWith('APPROVE') ||
                        a === 'ACCEPT' ||
                        a === 'PASS_TEST' ? (
                        <CheckCircleOutlined />
                      ) : (
                        <SendOutlined />
                      )}
                    </span>
                    <span>
                      <strong>{actionLabels[a]}</strong>
                      <small>
                        {a === 'CANCEL'
                          ? '结束当前需求，保留历史记录'
                          : a === 'SUBMIT_REQUIREMENT'
                            ? '交给研发完善方案，开始协作'
                            : a.startsWith('REJECT') || a === 'FAIL_TEST'
                              ? '补充说明，退回继续完善'
                              : '确认所需信息，进入下一步'}
                      </small>
                    </span>
                    <ArrowRightOutlined />
                  </button>
                ))}
              </div>
            }
            open={editing === 'status'}
            onOpenChange={(visible) =>
              setEditing((current) =>
                visible ? 'status' : current === 'status' ? '' : current,
              )
            }
          >
            <button
              className={`property-value property-status ${editing === 'status' ? 'is-open' : ''}`}
              aria-expanded={editing === 'status'}
              aria-label="选择状态操作"
              disabled={!transitions.length || busy}
              onClick={() => setEditing('status')}
            >
              <Tag color={edition.primary}>{workflowLabel(t)}</Tag>
              {transitions.length > 0 && <DownOutlined />}
            </button>
          </Popover>
        </dd>
      </div>
      <div>
        <dt>优先级</dt>
        <dd>
          {editor(
            'priority',
            '优先级',
            d.priority,
            <Select
              getPopupContainer={(trigger) => trigger.parentElement!}
              aria-label="选择优先级"
              value={value}
              onChange={setValue}
              options={['P0', 'P1', 'P2', 'P3'].map((v, i) => ({
                value: v,
                label: `${v} · ${['紧急', '高', '中', '低'][i]}`,
              }))}
            />,
            !!t.editableFields?.includes('priority'),
          )}
        </dd>
      </div>
      <div>
        <dt>所属项目</dt>
        <dd>
          <Tooltip title="项目关联已有需求编号与交付记录，暂不支持在此迁移">
            {projectName || '加载中…'}
          </Tooltip>
        </dd>
      </div>
      <div>
        <dt>类型</dt>
        <dd>{d.type === 'BUG' ? '缺陷修复' : '产品需求'}</dd>
      </div>
      <div>
        <dt>需求版本</dt>
        <dd>
          v{d.requirementVersion} · 数据版本 {t.version}
        </dd>
      </div>
      <div className="detail-facts-divider">
        <dt>当前处理人</dt>
        <dd>
          {t.handlerIds.length
            ? t.handlerIds.map(person).join('、')
            : '当前无需处理'}
        </dd>
      </div>
      {owners
        .filter(
          ([field]) =>
            d.workflow !== 'SIMPLE' ||
            ['productId', 'engineerId'].includes(field),
        )
        .map(([field, originalLabel]) => {
          const label =
            d.workflow === 'SIMPLE'
              ? field === 'engineerId'
                ? '执行人'
                : '需求负责人'
              : d.roleMode === 'COMPACT' && field === 'productId'
                ? '需求负责人'
                : d.roleMode === 'COMPACT' && field === 'engineerId'
                  ? '执行人'
                  : d.roleMode === 'COMPACT' && field === 'testerId'
                    ? '验收人'
                    : originalLabel;
          const current = (d as any)[field];
          const reviewer =
            field === 'productReviewerId' || field === 'qaReviewerId';
          const compactShared =
            d.roleMode === 'COMPACT' &&
            reviewer &&
            d.productReviewerId === d.qaReviewerId;
          const editable =
            t.allowedActions.includes('TRANSFER') &&
            !(reviewer && t.status === 'SOLUTION_REVIEW');
          return (
            <div key={field}>
              <dt>{label}</dt>
              <dd>
                {editor(
                  field,
                  label,
                  <span className="property-person">
                    <Avatar size={22}>{person(current)[0]}</Avatar>
                    {person(current)}
                    {compactShared && (
                      <Tag
                        color={edition.primary}
                        style={{ marginLeft: 8 }}
                        title="紧凑模式：产品评估人与测试评估人由同一人兼任"
                      >
                        同一人兼任两项评估
                      </Tag>
                    )}
                  </span>,
                  <Select
                    getPopupContainer={(trigger) => trigger.parentElement!}
                    aria-label={`选择${label}`}
                    showSearch
                    optionFilterProp="label"
                    value={value}
                    onChange={setValue}
                    options={members.map((m: Member) => ({
                      value: m.id,
                      label: m.name,
                    }))}
                  />,
                  editable,
                  true,
                  reviewer && t.status === 'SOLUTION_REVIEW'
                    ? '方案评估期间不可更换评估人'
                    : '',
                )}
              </dd>
            </div>
          );
        })}
      <div className="detail-facts-divider">
        <dt>创建时间</dt>
        <dd>{new Date(t.createdAt).toLocaleDateString('zh-CN')}</dd>
      </div>
      <div>
        <dt>计划截止</dt>
        <dd>
          {editor(
            'dueAt',
            '计划截止',
            d.dueAt ? new Date(d.dueAt).toLocaleDateString('zh-CN') : '未设置',
            <Input
              type="date"
              aria-label="选择计划截止"
              value={value || ''}
              onChange={(e) => setValue(e.target.value)}
            />,
            !!t.editableFields?.includes('dueAt'),
          )}
        </dd>
      </div>
      <div>
        <dt>最近更新</dt>
        <dd>{new Date(t.updatedAt).toLocaleString('zh-CN')}</dd>
      </div>
    </dl>
  );
}
