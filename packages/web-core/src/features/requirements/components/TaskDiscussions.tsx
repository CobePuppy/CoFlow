import { QuestionAssignment } from './QuestionAssignment.js';
import { useSearchParams } from 'react-router-dom';
import { useBrowserDraft } from '../../../shared/lib/useBrowserDraft.js';
import { DraftRecovery } from '../../../shared/ui/DraftRecovery.js';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Tag,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Member, Task } from '@coflow/contracts/index.js';
import {
  mergeDiscussionUpdates,
  type DiscussionSnapshot,
  discussionRoots,
  discussionView,
  type Discussion,
} from '@coflow/contracts/discussion.js';
import { api } from '../../../shared/api/runtime.js';
import { invalidateTaskQueries } from '../../../shared/api/query-invalidation.js';
import { Markdown } from '../../../shared/ui/Markdown.js';
import { useUnsavedChanges } from '../../../shared/lib/unsaved.js';
export function TaskDiscussions({
  task,
  userId,
  members,
}: {
  task: Task & { readOnly: boolean };
  userId: string;
  members: Member[];
}) {
  const qc = useQueryClient(),
    { message } = App.useApp();
  const discussionKey = ['taskDiscussions', task.id];
  const updates = useQuery<DiscussionSnapshot>({
    queryKey: discussionKey,
    queryFn: async ({ signal }) => {
      const previous = qc.getQueryData<DiscussionSnapshot>(discussionKey);
      const next = await api(
        `/tasks/${task.id}/discussion-updates?after=${previous?.total || 0}`,
        'GET',
        undefined,
        undefined,
        signal,
      );
      return mergeDiscussionUpdates(previous, next);
    },
    refetchInterval: 15000,
  });
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['taskDiscussions', task.id] });
  }, [task.version, task.id, qc]);
  useEffect(() => {
    if (updates.data && updates.data.taskVersion > task.version)
      void qc.invalidateQueries({ queryKey: ['task', task.id] });
  }, [updates.data?.taskVersion, task.version, task.id, qc]);
  const comments = useMemo(
    () => discussionView(updates.data?.comments || []),
    [updates.data?.comments],
  );
  const replyGroups = useMemo(() => {
    const groups = new Map<string, Discussion[]>();
    for (const c of comments)
      if (
        c.replyTo &&
        !['QUESTION_STATE', 'QUESTION_ASSIGNMENT'].includes(c.kind || '')
      ) {
        const list = groups.get(c.replyTo) || [];
        list.push(c);
        groups.set(c.replyTo, list);
      }
    return groups;
  }, [comments]);
  const [params] = useSearchParams();
  const target = params.get('discussion');
  const [assigneeId, setAssigneeId] = useState(userId),
    [dueAt, setDueAt] = useState('');
  useEffect(() => {
    if (target) {
      const frame = requestAnimationFrame(() => {
        const node = document.getElementById('discussion-' + target);
        node?.scrollIntoView({ block: 'center' });
        node?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [target, comments]);
  const [body, setBody] = useState(''),
    [kind, setKind] = useState('COMMENT'),
    [mentions, setMentions] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<string>(),
    [filter, setFilter] = useState('ALL'),
    [search, setSearch] = useState('');
  const [resolving, setResolving] = useState<Discussion>(),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editingBase, setEditingBase] = useState(task.data.requirementVersion);
  const draft = useBrowserDraft(
    [userId, task.workspaceId, task.projectId, 'discussion', task.id],
    !task.readOnly,
    task.data.requirementVersion,
    ['body', 'discussionKind', 'replyTo', 'replyTitle'],
  );
  const outdated =
    !!body.trim() && editingBase !== task.data.requirementVersion;
  function persist(
    nextBody = body,
    nextKind = kind,
    nextReply = replyTo,
    base = editingBase,
  ) {
    if (nextBody.trim())
      draft.save(
        {
          body: nextBody,
          discussionKind:
            nextKind === 'QUESTION'
              ? '待澄清问题'
              : nextKind === 'DECISION'
                ? '决策记录'
                : '普通评论',
          replyTo: nextReply || '',
          replyTitle:
            comments.find((c) => c.id === nextReply)?.body.slice(0, 100) || '',
        },
        base,
      );
    else draft.clear();
  }
  useUnsavedChanges(!!body || !!reason);
  async function publish() {
    if (outdated) return;
    setBusy(true);
    setError('');
    try {
      await api(`/tasks/${task.id}/comments`, 'POST', {
        body,
        kind: replyTo ? 'COMMENT' : kind,
        replyTo,
        mentions,
        ...(kind === 'QUESTION' && !replyTo
          ? { assigneeId, dueAt: dueAt || null }
          : {}),
        expectedVersion: task.version,
      });
      setBody('');
      setAssigneeId(userId);
      setDueAt('');
      draft.clear();
      setEditingBase(task.data.requirementVersion);
      setMentions([]);
      setReplyTo(undefined);
      invalidateTaskQueries(qc);
      message.success('讨论已保存');
    } catch (e) {
      setError((e as Error).message);
      invalidateTaskQueries(qc);
    } finally {
      setBusy(false);
    }
  }
  const roots = discussionRoots(
    comments,
    target ? 'ALL' : filter,
    target ? '' : search,
  );
  return (
    <section aria-label="讨论与决策">
      <h3>讨论与决策</h3>
      <Alert
        type="info"
        message="记录澄清过程和讨论结论；正式需求仍需通过需求变更流程更新。"
      />
      <Space wrap style={{ margin: '12px 0' }}>
        <Select
          aria-label="讨论筛选"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: '全部讨论' },
            {
              value: 'OPEN',
              label: `待解决问题（${comments.filter((c) => !c.replyTo && c.kind === 'QUESTION' && !c.resolved).length}）`,
            },
            { value: 'DECISION', label: '决策记录' },
          ]}
          style={{ width: 190 }}
        />
        <Input
          aria-label="搜索讨论"
          placeholder="搜索内容或作者（含回复）"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ maxWidth: '100%', width: 260 }}
        />
        <span className="muted">{roots.length} 条讨论</span>
      </Space>
      {updates.isPending && <p role="status">正在加载讨论…</p>}
      {updates.error && (
        <Alert
          type="error"
          message={updates.error.message}
          action={
            <Button onClick={() => updates.refetch()}>重试加载讨论</Button>
          }
        />
      )}
      {target &&
        !updates.isPending &&
        !updates.error &&
        !comments.some((c) => c.id === target && !c.replyTo) && (
          <Alert
            type="warning"
            message="定位的讨论已不可见，请在当前需求中重新查找"
          />
        )}
      {!updates.isPending && !updates.error && !roots.length && (
        <Empty description="暂无匹配讨论" />
      )}
      {roots.map((c) => (
        <Card
          size="small"
          className="history-card"
          key={c.id}
          id={'discussion-' + c.id}
          tabIndex={-1}
          style={target === c.id ? { border: '2px solid #1677ff' } : undefined}
          title={
            <Space wrap>
              <span>{c.name}</span>
              <Tag>
                {c.kind === 'QUESTION'
                  ? c.resolved
                    ? '问题已解决'
                    : '待解决问题'
                  : c.kind === 'DECISION'
                    ? '决策记录'
                    : '评论'}
              </Tag>
            </Space>
          }
        >
          <p className="muted">
            {new Date(c.at).toLocaleString('zh-CN')} ·{' '}
            {c.requirementVersion !== undefined
              ? `需求 V${c.requirementVersion}`
              : '历史评论未记录需求版本'}
          </p>
          <Markdown>{c.body}</Markdown>
          {c.kind === 'QUESTION' && (
            <QuestionAssignment
              task={task}
              question={c}
              members={members}
              userId={userId}
            />
          )}
          {(replyGroups.get(c.id) || []).map((r) => (
            <blockquote key={r.id}>
              <strong>{r.name}</strong> ·{' '}
              {new Date(r.at).toLocaleString('zh-CN')}
              <Markdown>{r.body}</Markdown>
            </blockquote>
          ))}
          {c.resolutions?.map((r, i) => (
            <p key={i}>
              {r.name} · {new Date(r.at).toLocaleString('zh-CN')} ·{' '}
              {r.resolved ? '解决' : '重新打开'}：{r.reason}
            </p>
          ))}
          <Space wrap>
            <Button
              onClick={async () => {
                const link = new URL(window.location.href);
                link.searchParams.set('task', task.id);
                link.searchParams.set('taskTab', 'activity');
                link.searchParams.set('discussion', c.id);
                try {
                  await navigator.clipboard.writeText(link.toString());
                  message.success('讨论链接已复制');
                } catch {
                  message.error('复制失败，请复制当前页面地址');
                }
              }}
            >
              复制讨论链接
            </Button>
            <Button
              disabled={task.readOnly || busy}
              onClick={() => {
                setReplyTo(c.id);
                persist(body, kind, c.id);
                document.getElementById('discussion-body')?.focus();
              }}
            >
              回复此讨论
            </Button>
            {c.kind === 'QUESTION' &&
              (c.by === userId ||
                c.assigneeId === userId ||
                task.data.productId === userId) && (
                <Button
                  disabled={task.readOnly || busy}
                  onClick={() => {
                    setResolving(c);
                    setReason('');
                    setError('');
                  }}
                >
                  {c.resolved ? '重新打开问题' : '标记解决'}
                </Button>
              )}
          </Space>
        </Card>
      ))}
      {replyTo && (
        <Alert
          type="info"
          message={
            '正在回复：' +
            (comments.find((c) => c.id === replyTo)?.body || '').slice(0, 100)
          }
          action={
            <Button
              disabled={busy}
              onClick={() => {
                setReplyTo(undefined);
                persist(body, kind, '');
              }}
            >
              取消回复
            </Button>
          }
        />
      )}
      <Space wrap style={{ margin: '12px 0' }}>
        <Select
          aria-label="讨论类型"
          disabled={!!replyTo || task.readOnly || busy}
          value={replyTo ? 'COMMENT' : kind}
          onChange={(value) => {
            setKind(value);
            persist(body, value);
          }}
          options={[
            { value: 'COMMENT', label: '普通评论' },
            { value: 'QUESTION', label: '待澄清问题' },
            { value: 'DECISION', label: '决策记录' },
          ]}
          style={{ width: 160 }}
        />
        <Select
          aria-label="提及项目成员"
          mode="multiple"
          disabled={task.readOnly || busy}
          placeholder="@ 提及项目成员"
          value={mentions}
          onChange={setMentions}
          options={members.map((m) => ({ value: m.id, label: m.name }))}
          style={{ width: 260, maxWidth: '100%' }}
        />
      </Space>
      {kind === 'QUESTION' && !replyTo && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            aria-label="新问题跟进人"
            value={assigneeId}
            disabled={busy || task.readOnly}
            onChange={setAssigneeId}
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            style={{ width: 200 }}
          />
          <Input
            aria-label="新问题截止日期"
            type="date"
            value={dueAt}
            disabled={busy || task.readOnly}
            onChange={(e) => setDueAt(e.target.value)}
            style={{ width: 180 }}
          />
        </Space>
      )}
      <DraftRecovery
        draft={draft}
        disabled={task.readOnly || busy || updates.isPending || !!updates.error}
        fieldLabels={{
          body: '讨论正文',
          discussionKind: '讨论类型',
          replyTo: '',
          replyTitle: '回复对象',
        }}
        onRestore={(values) => {
          setBody(String(values.body || ''));
          setKind(
            values.discussionKind === '待澄清问题'
              ? 'QUESTION'
              : values.discussionKind === '决策记录'
                ? 'DECISION'
                : 'COMMENT',
          );
          const target = String(values.replyTo || '');
          setReplyTo(
            comments.some((c) => c.id === target && !c.replyTo)
              ? target
              : undefined,
          );
          setMentions([]);
          setAssigneeId(userId);
          setDueAt('');
          setEditingBase(task.data.requirementVersion);
          message.info('已恢复讨论，提及成员、跟进人及日期请重新确认');
        }}
      />
      {outdated && (
        <Alert
          type="warning"
          message="正式需求版本已变化，请核对新版需求再继续发表"
          action={
            <Button
              disabled={busy}
              onClick={() => {
                setEditingBase(task.data.requirementVersion);
                persist(body, kind, replyTo, task.data.requirementVersion);
              }}
            >
              已核对新版需求
            </Button>
          }
        />
      )}
      <Input.TextArea
        id="discussion-body"
        aria-label="讨论内容"
        disabled={task.readOnly || busy}
        value={body}
        onChange={(e) => {
          const base = body ? editingBase : task.data.requirementVersion;
          if (!body) setEditingBase(base);
          setBody(e.target.value);
          persist(e.target.value, kind, replyTo, base);
        }}
        placeholder="补充说明，支持 Markdown"
        maxLength={20000}
        showCount
        rows={3}
      />
      {error && !resolving && <Alert type="error" message={error} />}
      <Button
        style={{ margin: '16px 0' }}
        type="primary"
        aria-label={replyTo ? '保存回复' : '发表评论'}
        aria-busy={busy}
        disabled={task.readOnly || !body.trim() || outdated || busy}
        loading={busy}
        onClick={publish}
      >
        {replyTo ? '保存回复' : '发表评论'}
      </Button>
      <Modal
        title={resolving?.resolved ? '重新打开问题' : '标记解决'}
        open={!!resolving}
        okText="保存问题状态"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{
          disabled: !reason.trim() || busy,
          'aria-label': '保存问题状态',
        }}
        onCancel={() => {
          if (!busy) {
            setResolving(undefined);
            setReason('');
            setError('');
          }
        }}
        onOk={async () => {
          if (!resolving) return;
          setBusy(true);
          setError('');
          try {
            await api(`/tasks/${task.id}/comments/${resolving.id}`, 'PATCH', {
              expectedVersion: task.version,
              resolved: !resolving.resolved,
              reason,
            });
            setResolving(undefined);
            setReason('');
            invalidateTaskQueries(qc);
          } catch (e) {
            setError((e as Error).message);
            invalidateTaskQueries(qc);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="discussion-reason">结论或重新打开原因</label>
        <Input.TextArea
          id="discussion-reason"
          value={reason}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        {error && <Alert type="error" message={error} />}
      </Modal>
    </section>
  );
}
