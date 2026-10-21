import { assert, BusinessError } from '../../modules/requirements/domain.js';

export const repositoryName =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
export function parseRepository(value: string) {
  const name = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  assert(
    repositoryName.test(name) &&
      !name.split('/').some((x) => x === '.' || x === '..'),
    '请输入 owner/repo 或 GitHub HTTPS 仓库地址',
  );
  return name;
}
export function safePath(value: string) {
  assert(
    value.length <= 1024 &&
      value.split('/').length <= 32 &&
      !value.includes('\\') &&
      !/[\x00-\x1f\x7f]/.test(value) &&
      (value === '' ||
        value.split('/').every((x) => x && x !== '.' && x !== '..')),
    '文件路径无效',
  );
  return value;
}
export class GitHubClient {
  private deadline = Date.now() + 25000;
  constructor(
    private token?: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async json(path: string, body?: Record<string, string>, oauth = false) {
    assert(
      Date.now() < this.deadline,
      'GitHub 读取耗时过长，请缩短目录路径后重试',
      504,
    );
    const url = oauth
      ? 'https://github.com/login/' + path
      : 'https://api.github.com' + path;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(12000, this.deadline - Date.now())),
        ),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CoFlow',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(!oauth
            ? {
                'X-GitHub-Api-Version': '2026-03-10',
                ...(this.token
                  ? { Authorization: `Bearer ${this.token}` }
                  : {}),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new BusinessError(502, 'GitHub 连接超时或不可用，请重试');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BusinessError(
        response.status === 401
          ? 403
          : response.status === 404
            ? 404
            : response.status === 409
              ? 409
              : response.status === 403 || response.status === 429
                ? 429
                : 502,
        response.status === 401
          ? 'GitHub 授权已失效，请重新连接账号'
          : response.status === 404
            ? '仓库不存在或当前 GitHub 账号无权读取，请检查应用安装与授权'
            : response.status === 409
              ? '仓库为空或提交存在冲突，暂无可读取的快照'
              : response.status === 403 || response.status === 429
                ? 'GitHub 权限不足或请求额度受限，请检查授权或稍后重试'
                : 'GitHub 请求失败',
      );
    }
    assert(response.body, 'GitHub 返回了空响应', 502);
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        assert(size <= 8 * 1024 * 1024, 'GitHub 响应过大，无法完整读取', 413);
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      throw new BusinessError(502, 'GitHub 响应读取失败，请重试');
    } finally {
      await reader.cancel().catch(() => {});
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new BusinessError(502, 'GitHub 返回了无效数据');
    }
  }
  async repository(name: string) {
    const repo = await this.json('/repos/' + parseRepository(name));
    assert(
      repo.full_name &&
        repositoryName.test(repo.full_name) &&
        Number.isSafeInteger(repo.id),
      'GitHub 仓库数据无效',
      502,
    );
    return {
      id: repo.id,
      name: repo.full_name,
      description: repo.description || '',
      private: !!repo.private,
      defaultBranch: repo.default_branch,
    };
  }
  async snapshot(name: string, branch: string) {
    assert(
      branch.length > 0 &&
        branch.length <= 255 &&
        !/[\x00-\x1f\x7f]/.test(branch),
      '分支无效',
    );
    const commit = await this.json(
      '/repos/' + name + '/commits/' + encodeURIComponent(branch),
    );
    assert(
      /^[a-f0-9]{40}$/.test(commit.sha) &&
        /^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha),
      'GitHub 提交数据无效',
      502,
    );
    return {
      branch,
      commit: commit.sha,
      tree: commit.commit.tree.sha,
      readAt: new Date().toISOString(),
    };
  }
  async entries(name: string, tree: string) {
    const result = await this.json(`/repos/${name}/git/trees/${tree}`);
    assert(
      !result.truncated && Array.isArray(result.tree),
      '目录过大，GitHub 未返回完整目录；请在 GitHub 中查看',
      413,
    );
    return result.tree.map((x: any) => {
      assert(
        typeof x.path === 'string' &&
          x.path &&
          !x.path.includes('/') &&
          safePath(x.path) &&
          /^[a-f0-9]{40}$/.test(x.sha),
        'GitHub 目录数据无效',
        502,
      );
      return {
        name: x.path,
        sha: x.sha,
        mode: x.mode,
        size: x.size || 0,
        type: x.type,
      };
    });
  }
  async locate(name: string, tree: string, path: string) {
    const parts = safePath(path).split('/').filter(Boolean);
    let current = tree;
    let entry: any;
    for (let i = 0; i < parts.length; i++) {
      entry = (await this.entries(name, current)).find(
        (x: any) => x.name === parts[i],
      );
      assert(entry, '路径不存在', 404);
      if (i < parts.length - 1)
        assert(entry.mode === '040000', '不支持读取符号链接或子模块');
      current = entry.sha;
    }
    return entry || { sha: tree, mode: '040000' };
  }
  async file(name: string, tree: string, path: string) {
    const entry = await this.locate(name, tree, path);
    assert(
      ['100644', '100755'].includes(entry.mode),
      '只支持普通文本文件，不读取目录、符号链接或子模块',
    );
    assert(
      entry.size <= 1024 * 1024,
      '文件超过 1 MiB，请在 GitHub 中查看',
      413,
    );
    const blob = await this.json(`/repos/${name}/git/blobs/${entry.sha}`);
    assert(
      blob.encoding === 'base64' &&
        typeof blob.content === 'string' &&
        blob.size <= 1024 * 1024,
      '文件过大或编码不受支持',
      413,
    );
    const bytes = Buffer.from(blob.content, 'base64');
    assert(
      bytes.length <= 1024 * 1024 && !bytes.includes(0),
      '不支持二进制文件或超大文件',
      413,
    );
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new BusinessError(422, '仅支持 UTF-8 文本文件');
    }
    return { path, sha: entry.sha, text, size: bytes.length };
  }
}
