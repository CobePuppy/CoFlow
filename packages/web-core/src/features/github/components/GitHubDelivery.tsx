import { GitHubAccountConnection } from './GitHubAccountConnection.js';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';
import { api, useData } from '../../../shared/api/runtime.js';

export function GitHubAcceptanceLinks({
  taskId,
  index,
  text,
}: {
  taskId: string;
  index: number;
  text: string;
}) {
  const q = useData(['taskGithub', taskId], `/tasks/${taskId}/github`);
  const b = q.data;
  if (!b?.data || b.accessError || q.error) return null;
  const references = (b.data.references || []).filter(
    (x: any) => x.criterion?.index === index && x.criterion.text === text,
  );
  return references.length ? (
    <div className="github-acceptance-links">
      {references.map((ref: any) => (
        <div key={ref.path}>
          <a
            href={`https://github.com/${b.data.name}/blob/${ref.commit}/${ref.path.split('/').map(encodeURIComponent).join('/')}${ref.startLine ? `#L${ref.startLine}-L${ref.endLine}` : ''}`}
            target="_blank"
            rel="noreferrer"
          >
            代码依据：{ref.path}
            {ref.startLine ? ` L${ref.startLine}–L${ref.endLine}` : ''}
          </a>
          {ref.note && <span> · {ref.note}</span>}
        </div>
      ))}
    </div>
  ) : null;
}

export function GitHubRepositoryPicker({
  onSelect,
  disabled = false,
}: {
  onSelect: (name: string) => void;
  disabled?: boolean;
}) {
  const account = useData(['githubAccount'], '/github/account');
  const epoch = useRef(0);
  const [installations, setInstallations] = useState<any[]>([]),
    [installationPage, setInstallationPage] = useState(0),
    [moreInstallations, setMoreInstallations] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [repositories, setRepositories] = useState<any[]>([]),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    epoch.current++;
    setInstallations([]);
    setInstallationPage(0);
    setMoreInstallations(false);
    setSelected(undefined);
    setRepositories([]);
    setPage(0);
    setMore(false);
    setBusy(false);
    setError('');
  }, [account.data?.login]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  async function load(installationId?: number, next = 1) {
    const requestEpoch = epoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await api(
        installationId
          ? `/github/repositories?installationId=${installationId}&page=${next}`
          : `/github/installations?page=${installationPage + 1}`,
      );
      if (requestEpoch !== epoch.current) return;
      if (installationId) {
        setRepositories((previous) =>
          next === 1 ? result.items : [...previous, ...result.items],
        );
        setPage(result.page);
        setMore(result.hasMore);
      } else {
        setInstallations((previous) => [...previous, ...result.items]);
        setInstallationPage(result.page);
        setMoreInstallations(result.hasMore);
      }
    } catch (e: any) {
      if (requestEpoch === epoch.current) setError(e.message);
    } finally {
      if (requestEpoch === epoch.current) setBusy(false);
    }
  }
  return (
    <div className="github-picker">
      <Space wrap>
        <Button
          disabled={
            disabled ||
            busy ||
            !account.data?.login ||
            (installationPage > 0 && !moreInstallations)
          }
          onClick={() => load()}
        >
          {installationPage ? '继续读取授权组织' : '选择已授权仓库'}
        </Button>
        {installationPage > 0 && (
          <Select
            aria-label="GitHub 授权组织"
            placeholder="选择个人或组织安装"
            value={selected}
            disabled={disabled || busy}
            options={installations.map((x) => ({ value: x.id, label: x.name }))}
            onChange={(value) => {
              setSelected(value);
              setRepositories([]);
              setPage(0);
              void load(value);
            }}
            style={{ minWidth: 180 }}
          />
        )}
        {page > 0 && (
          <Select
            aria-label="已授权 GitHub 仓库"
            showSearch
            optionFilterProp="label"
            placeholder="搜索已加载仓库"
            disabled={disabled || busy}
            onChange={onSelect}
            options={repositories.map((x) => ({
              value: x.name,
              label: `${x.name}${x.private ? '（私有）' : ''}`,
            }))}
            style={{ minWidth: 220, maxWidth: '100%' }}
          />
        )}
        {more && (
          <Button
            disabled={busy || disabled}
            onClick={() => load(selected, page + 1)}
          >
            继续读取仓库
          </Button>
        )}
      </Space>
      {!account.data?.login && (
        <p className="github-meta">
          选择私有仓库前，请先在账号授权区登录 GitHub 并连接；公开仓库可直接填写
          owner/repo。
        </p>
      )}
      {installationPage > 0 && installations.length === 0 && (
        <p>
          没有可用安装，请先点击上方“安装或调整仓库授权”，允许读取对应仓库，再刷新本页。
        </p>
      )}
      {page > 0 && (
        <p className="github-meta">
          已加载 {repositories.length} 个仓库
          {more ? '，还有更多；搜索仅覆盖已加载项' : '，当前安装已全部加载'}
        </p>
      )}
      {error && <Alert type="warning" message={error} />}
    </div>
  );
}

export function ProjectGitHubSettings({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const q = useData(
    ['projectGithub', projectId],
    `/projects/${projectId}/github`,
  );
  const [name, setName] = useState(''),
    [branch, setBranch] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { message, modal } = App.useApp();
  useEffect(() => {
    setName(q.data?.data?.name || '');
    setBranch(q.data?.data?.branch || '');
  }, [q.data?.version]);
  async function save(remove = false) {
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${projectId}/github`, remove ? 'DELETE' : 'PUT', {
        version: q.data?.version || 0,
        repository: name,
        ...(branch ? { branch } : {}),
      });
      await q.refetch();
      message.success('项目默认仓库已更新');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <GitHubAccountConnection />
      <Card size="small" title="项目默认 GitHub 仓库" style={{ marginTop: 16 }}>
        <p>
          需求可明确采用默认仓库并保存独立快照。修改项目默认值不会替换已有需求的仓库或代码引用。
        </p>
        {q.isLoading ? (
          <Spin />
        ) : (
          <div className="github-default-form">
            <Input
              aria-label="项目默认 GitHub 仓库"
              placeholder="owner/repo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled || busy}
            />
            <Input
              aria-label="项目默认 GitHub 分支"
              placeholder="默认分支（可留空）"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={disabled || busy}
            />
            <GitHubRepositoryPicker
              disabled={disabled || busy}
              onSelect={(value) => {
                setName(value);
                setBranch('');
              }}
            />
            <Space wrap>
              <Button
                disabled={disabled || busy || q.isError || !name.trim()}
                onClick={() => save()}
              >
                保存默认仓库
              </Button>
              {q.data?.data && (
                <Button
                  danger
                  disabled={disabled || busy}
                  onClick={() =>
                    modal.confirm({
                      title: '移除项目默认仓库？',
                      content: '已有需求的关联与引用将保留。',
                      onOk: () => save(true),
                    })
                  }
                >
                  移除默认仓库
                </Button>
              )}
            </Space>
          </div>
        )}
        {(error || q.error) && (
          <Alert type="error" message={error || q.error?.message} />
        )}
      </Card>
    </>
  );
}

export function GitHubPull({ base, number, version, readOnly, onChange }: any) {
  const q = useData(
    ['githubPull', base, number, version],
    `${base}/pulls/${number}`,
  );
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const labels: Record<string, string> = {
    merged: '已合并',
    draft: '草稿',
    open: '待合并',
    closed: '已关闭',
  };
  const p = q.data;
  return (
    <Card
      size="small"
      title={`PR #${number}`}
      extra={<Button onClick={() => q.refetch()}>刷新状态</Button>}
    >
      {q.isLoading && <Spin />}
      {q.error && <Alert type="warning" message={q.error.message} />}
      {p && (
        <>
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.title}
          </a>{' '}
          <Tag>{labels[p.state] || p.state}</Tag>
          <p className="github-meta">
            {p.head} → {p.base} · {p.sha.slice(0, 12)} ·{' '}
            {new Date(p.readAt).toLocaleString('zh-CN')}
          </p>
          {[
            ['Checks', p.checks],
            ['提交状态', p.statuses],
          ].map(([label, data]: any) => (
            <div key={label}>
              <strong>{label}</strong>
              {data.error ? (
                <Alert type="warning" message={data.error} />
              ) : (
                <>
                  <p>
                    {data.total
                      ? `共 ${data.total} 项`
                      : '未发现检查记录，不能据此判断已通过'}
                    {data.incomplete
                      ? '，仅显示前 100 项，请到 GitHub 查看完整结果'
                      : ''}
                  </p>
                  {data.items.map((x: any, index: number) => (
                    <div key={index}>
                      {x.name}：{x.conclusion || x.state || x.status}
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </>
      )}
      <Button
        danger
        disabled={readOnly || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(base + '/pulls', 'POST', {
              version,
              pull: String(number),
              remove: true,
            });
            await onChange();
          } catch (e: any) {
            message.error(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        解除 PR 关联
      </Button>
    </Card>
  );
}
