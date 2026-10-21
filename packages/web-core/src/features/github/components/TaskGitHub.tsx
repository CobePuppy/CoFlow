import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
} from 'antd';
import { api, useData } from '../../../shared/api/runtime.js';
import './github.css';
import { GitHubAccountConnection } from './GitHubAccountConnection.js';
import { GitHubRepositoryPicker, GitHubPull } from './GitHubDelivery.js';
import { referenceLineCount } from '@coflow/contracts/github.js';

export function TaskGitHub({ task, userId }: { task: any; userId: string }) {
  const readOnly =
    task.readOnly ||
    !(
      task.canManage ||
      [task.data.productId, task.data.engineerId].includes(userId)
    );
  const { message, modal } = App.useApp();
  const base = `/tasks/${task.id}/github`;
  const q = useData(['taskGithub', task.id], base);
  const projectDefault = useData(
    ['projectGithub', task.projectId],
    `/projects/${task.projectId}/github`,
  );
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branchPage, setBranchPage] = useState(0);
  const [moreBranches, setMoreBranches] = useState(false);
  const [path, setPath] = useState('');
  const [file, setFile] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [startLine, setStartLine] = useState<number | null>(null),
    [endLine, setEndLine] = useState<number | null>(null),
    [note, setNote] = useState(''),
    [criterion, setCriterion] = useState<string | null>(null);
  const [pull, setPull] = useState('');
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const fileAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const b = q.data?.data?.name ? q.data : null;
  const tree = useData(
    ['githubTree', task.id, b?.version, path],
    `${base}/tree?path=${encodeURIComponent(path)}`,
    !!b && !b.accessError,
  );
  useEffect(() => {
    generation.current++;
    fileAbort.current?.abort();
    setFile(null);
    setPath('');
    setBranches([]);
    setBranchPage(0);
    setBranch(b?.data.branch || '');
    setRepository(b?.data.name || '');
  }, [b?.version, b?.accessError, task.id]);
  useEffect(
    () => () => {
      generation.current++;
      fileAbort.current?.abort();
    },
    [],
  );
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      if (e.name !== 'AbortError') message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    await api(base, 'PUT', {
      version: q.data?.version || 0,
      repository,
      ...(branch ? { branch } : {}),
    });
    setFile(null);
    setPath('');
    await q.refetch();
    message.success('仓库快照已保存');
  }
  async function read(path: string, reference = false) {
    closeFile();
    const current = generation.current;
    const controller = new AbortController();
    fileAbort.current = controller;
    setFile(null);
    const result = await api(
      `${base}/file?path=${encodeURIComponent(path)}${reference ? '&reference=1' : ''}`,
      'GET',
      undefined,
      undefined,
      controller.signal,
    );
    if (generation.current === current) {
      setStartLine(result.reference?.startLine || null);
      setEndLine(result.reference?.endLine || null);
      setNote(result.reference?.note || '');
      setCriterion(
        result.reference?.criterion
          ? JSON.stringify(result.reference.criterion)
          : null,
      );
      setFile({ ...result, reference });
    }
  }
  function closeFile() {
    generation.current++;
    fileAbort.current?.abort();
    setFile(null);
  }
  async function saveReference() {
    await api(base + '/references', 'POST', {
      version: file.version,
      path: file.path,
      keepSnapshot: !!file.reference,
      ...(startLine !== null ? { startLine } : {}),
      ...(endLine !== null ? { endLine } : {}),
      note,
      criterion: criterion ? JSON.parse(criterion) : null,
    });
    closeFile();
    await q.refetch();
    message.success('代码引用已保存');
  }
  async function adoptDefault() {
    const source = projectDefault.data;
    await api(base, 'PUT', {
      version: q.data?.version || 0,
      repository: source.data.name,
      branch: source.data.branch,
      inheritVersion: source.version,
    });
    await q.refetch();
  }
  async function loadBranches() {
    const result = await api(`${base}/branches?page=${branchPage + 1}`);
    setBranches((previous) => [...new Set([...previous, ...result.items])]);
    setBranchPage(result.page);
    setMoreBranches(result.hasMore);
  }
  if (q.isLoading) return <Spin />;
  if (q.error)
    return (
      <Alert
        type="error"
        showIcon
        message={q.error.message}
        action={<Button onClick={() => q.refetch()}>重试读取</Button>}
      />
    );
  return (
    <div className="github-panel">
      <GitHubAccountConnection
        onChange={() => {
          generation.current++;
          fileAbort.current?.abort();
          setFile(null);
          void q.refetch();
        }}
      />
      <Card size="small" title="需求关联仓库">
        {projectDefault.error && (
          <Alert type="warning" message={projectDefault.error.message} />
        )}
        {projectDefault.data?.data && (
          <Space wrap>
            <span>
              项目默认：{projectDefault.data.data.name} ·{' '}
              {projectDefault.data.data.branch}
            </span>
            <Button
              disabled={readOnly || busy}
              onClick={() =>
                modal.confirm({
                  title: '采用项目默认仓库？',
                  content:
                    '本需求会保存独立快照，更换仓库会清除已有引用和 PR 关联。',
                  onOk: () => run(adoptDefault),
                })
              }
            >
              采用项目默认仓库
            </Button>
          </Space>
        )}
        <GitHubRepositoryPicker
          disabled={readOnly || busy}
          onSelect={(name) => {
            setRepository(name);
            setBranch('');
          }}
        />
        <div className="github-connect">
          <Input
            aria-label="GitHub 仓库地址"
            placeholder="owner/repo 或 https://github.com/owner/repo"
            value={repository}
            onChange={(e) => {
              setRepository(e.target.value);
              setBranch('');
            }}
            disabled={readOnly}
          />
          <Input
            aria-label="GitHub 分支"
            placeholder="分支（留空使用默认分支）"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={readOnly}
          />
        </div>
        <Space wrap>
          <Button
            type="primary"
            disabled={readOnly || busy || !repository.trim()}
            onClick={() =>
              b
                ? modal.confirm({
                    title: '更新仓库关联与快照？',
                    content:
                      '更换仓库会清除旧代码引用；同一仓库更新分支或提交会保留已有引用的原提交。',
                    onOk: () => run(connect),
                  })
                : run(connect)
            }
          >
            {b ? '更新关联与快照' : '连接仓库'}
          </Button>
          {b && (
            <Button
              danger
              disabled={readOnly || busy}
              onClick={() =>
                modal.confirm({
                  title: '解除仓库关联？',
                  content: '将移除本需求的全部代码引用。',
                  onOk: () =>
                    run(async () => {
                      await api(base, 'DELETE', { version: b.version });
                      setFile(null);
                      await q.refetch();
                    }),
                })
              }
            >
              解除关联
            </Button>
          )}
        </Space>
        {b && (
          <>
            <p className="github-meta">
              {b.data.name} · {b.data.branch}
              {b.data.source === 'PROJECT' ? ' · 采用自项目默认仓库' : ''}
              <br />
              快照提交 {b.data.commit}
              <br />
              读取时间 {new Date(b.data.readAt).toLocaleString('zh-CN')}
            </p>
            {b.accessError ? (
              <Alert
                type="warning"
                message={b.accessError}
                action={<Button onClick={() => q.refetch()}>重试读取</Button>}
              />
            ) : (
              <>
                <p>{b.repository?.description}</p>
                <Button
                  disabled={busy}
                  style={{ marginRight: 8, marginBottom: 8 }}
                  onClick={() =>
                    run(async () => {
                      const latest = await api(base + '/upstream');
                      if (!latest.changed) {
                        message.success('当前已是分支最新提交');
                        return;
                      }
                      modal.confirm({
                        title: '分支有新提交，更新需求快照？',
                        content: `${b.data.commit.slice(0, 12)} → ${latest.commit.slice(0, 12)}。原代码引用继续保留，需逐条确认更新。`,
                        okButtonProps: { disabled: readOnly },
                        onOk: () =>
                          run(async () => {
                            await api(base, 'PUT', {
                              version: b.version,
                              repository: b.data.name,
                              branch: b.data.branch,
                            });
                            await q.refetch();
                          }),
                      });
                    })
                  }
                >
                  检查分支新提交
                </Button>
                <Space wrap>
                  <Button
                    disabled={busy || (branchPage > 0 && !moreBranches)}
                    onClick={() => run(loadBranches)}
                  >
                    {branchPage ? '继续读取分支' : '读取可选分支'}
                  </Button>
                  {branches.length > 0 && (
                    <Select
                      aria-label="选择 GitHub 分支"
                      showSearch
                      value={branch}
                      onChange={setBranch}
                      options={branches.map((value) => ({
                        value,
                        label: value,
                      }))}
                      style={{ minWidth: 180 }}
                    />
                  )}
                  <span>
                    {branchPage > 0 &&
                      (moreBranches ? '还有更多分支' : '已读取全部分支')}
                  </span>
                </Space>
              </>
            )}
          </>
        )}
      </Card>
      {b && !b.accessError && (
        <>
          <Card size="small" title="仓库目录与文件">
            <Space wrap>
              <Button
                onClick={() => {
                  setPath('');
                  closeFile();
                }}
              >
                仓库根目录
              </Button>
              {path && (
                <Button
                  onClick={() => {
                    setPath(path.split('/').slice(0, -1).join('/'));
                    closeFile();
                  }}
                >
                  返回上级
                </Button>
              )}
              <span className="github-meta">/{path}</span>
            </Space>
            {tree.isLoading && <Spin />}
            {tree.error && (
              <Alert
                type="error"
                message={tree.error.message}
                action={
                  <Button onClick={() => tree.refetch()}>重试读取</Button>
                }
              />
            )}
            <div className="github-files">
              {tree.data?.items.map((entry: any) => {
                const full = path ? `${path}/${entry.name}` : entry.name;
                const supported = ['040000', '100644', '100755'].includes(
                  entry.mode,
                );
                return (
                  <Button
                    key={entry.name}
                    type="text"
                    disabled={!supported || busy}
                    onClick={() =>
                      entry.mode === '040000'
                        ? (setPath(full), closeFile())
                        : run(() => read(full))
                    }
                  >
                    {entry.mode === '040000' ? '📁' : '📄'} {entry.name}
                    {!supported ? '（符号链接/子模块不支持读取）' : ''}
                  </Button>
                );
              })}
            </div>
            {tree.data?.items.length === 0 && <Empty description="空目录" />}
          </Card>
          <Card size="small" title="需求代码引用（保留原提交）">
            {b.data.references.length === 0 ? (
              <Empty description="打开 README 或源文件后，可保存为需求代码引用" />
            ) : (
              b.data.references.map((ref: any) => (
                <div key={ref.path} className="github-reference">
                  <Button
                    type="link"
                    onClick={() => run(() => read(ref.path, true))}
                  >
                    {ref.path}
                  </Button>
                  <span className="github-meta">
                    {ref.startLine
                      ? `L${ref.startLine}–L${ref.endLine} · `
                      : ''}
                    {ref.commit.slice(0, 12)} ·{' '}
                    {new Date(ref.readAt).toLocaleString('zh-CN')}
                  </span>
                  {ref.note && <p>{ref.note}</p>}
                  {ref.criterion && (
                    <p>
                      关联验收项：{ref.criterion.text}
                      {task.data.criteria[ref.criterion.index] !==
                      ref.criterion.text
                        ? '（标准已变更，请重新核对）'
                        : ''}
                    </p>
                  )}
                  {ref.commit !== b.data.commit && (
                    <span>来自旧提交，尚未更新引用</span>
                  )}
                  {updates[ref.path] && <p>{updates[ref.path]}</p>}
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const d = await api(
                          `${base}/upstream?path=${encodeURIComponent(ref.path)}`,
                        );
                        setUpdates((previous) => ({
                          ...previous,
                          [ref.path]: d.deleted
                            ? '上游文件已删除，原引用仍保留'
                            : !d.supported
                              ? '上游已变为不支持读取的类型'
                              : d.changed
                                ? '上游文件已有变化；先更新需求快照，再确认更新引用'
                                : '文件内容与上游一致',
                        }));
                      })
                    }
                  >
                    检查文件更新
                  </Button>
                  <Button
                    disabled={readOnly || busy || ref.commit === b.data.commit}
                    onClick={() =>
                      modal.confirm({
                        title: '更新引用至当前快照？',
                        content:
                          '请核对行范围与验收关联是否仍适用。原引用提交将被替换。',
                        onOk: () =>
                          run(async () => {
                            await api(base + '/references', 'POST', {
                              version: b.version,
                              path: ref.path,
                              ...(ref.startLine
                                ? {
                                    startLine: ref.startLine,
                                    endLine: ref.endLine,
                                  }
                                : {}),
                              note: ref.note || '',
                              criterion: ref.criterion || null,
                            });
                            await q.refetch();
                          }),
                      })
                    }
                  >
                    更新引用至当前快照
                  </Button>
                  <Button
                    disabled={readOnly || busy}
                    onClick={() =>
                      run(async () => {
                        await api(base + '/references', 'POST', {
                          version: b.version,
                          path: ref.path,
                          remove: true,
                        });
                        await q.refetch();
                      })
                    }
                  >
                    移除引用
                  </Button>
                </div>
              ))
            )}
          </Card>
          <Card size="small" title="关联 Pull Request（只读同步）">
            <p>读取 PR 状态与检查结果，不自动改变需求阶段或验收结论。</p>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                aria-label="GitHub PR 编号或地址"
                placeholder="#123 或当前仓库 PR 地址"
                value={pull}
                onChange={(e) => setPull(e.target.value)}
                disabled={readOnly || busy}
              />
              <Button
                disabled={readOnly || busy || !pull.trim()}
                onClick={() =>
                  run(async () => {
                    await api(base + '/pulls', 'POST', {
                      version: b.version,
                      pull,
                    });
                    setPull('');
                    await q.refetch();
                  })
                }
              >
                关联 PR
              </Button>
            </Space.Compact>
            {(b.data.pulls || []).map((number: number) => (
              <GitHubPull
                key={number}
                base={base}
                number={number}
                version={b.version}
                readOnly={readOnly}
                onChange={() => q.refetch()}
              />
            ))}
          </Card>
        </>
      )}
      <Modal
        open={!!file}
        title={file?.path}
        width={1000}
        onCancel={closeFile}
        footer={
          file && (
            <Space wrap>
              <span>提交 {file.commit.slice(0, 12)}</span>
              {
                <Button
                  type="primary"
                  disabled={readOnly || busy || file.version !== b?.version}
                  onClick={() => run(saveReference)}
                >
                  {file.reference ? '保存引用设置' : '保存为需求代码引用'}
                </Button>
              }
            </Space>
          )
        }
      >
        {file && (
          <div className="github-reference-form">
            <p>
              文件共 {referenceLineCount(file.text)} 行；留空表示引用整个文件。
            </p>
            <Space wrap>
              <InputNumber
                aria-label="引用起始行"
                placeholder="起始行"
                min={1}
                value={startLine}
                onChange={setStartLine}
                disabled={readOnly}
              />
              <InputNumber
                aria-label="引用结束行"
                placeholder="结束行"
                min={1}
                value={endLine}
                onChange={setEndLine}
                disabled={readOnly}
              />
            </Space>
            <Input.TextArea
              aria-label="代码引用说明"
              placeholder="说明这段代码与需求的关系"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={readOnly}
            />
            <Select
              aria-label="关联验收项"
              placeholder="关联验收项（可选）"
              allowClear
              value={criterion}
              onChange={(value) => setCriterion(value || null)}
              disabled={readOnly}
              style={{ width: '100%' }}
              options={[
                ...(criterion &&
                !task.data.criteria.some(
                  (text: string, index: number) =>
                    JSON.stringify({ index, text }) === criterion,
                )
                  ? [
                      {
                        value: criterion,
                        label: '原验收项已变更，请重新选择',
                        disabled: true,
                      },
                    ]
                  : []),
                ...task.data.criteria.map((text: string, index: number) => ({
                  value: JSON.stringify({ index, text }),
                  label: `${index + 1}. ${text}`,
                })),
              ]}
            />
            {startLine && endLine && endLine >= startLine && (
              <pre className="github-excerpt" aria-label="所选行预览">
                {file.text
                  .split('\n')
                  .slice(startLine - 1, endLine)
                  .join('\n')}
              </pre>
            )}
          </div>
        )}
        <pre className="github-source">{file?.text}</pre>
      </Modal>
    </div>
  );
}
