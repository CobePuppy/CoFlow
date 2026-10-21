# GitHub 仓库连接与读取

需求详情新增独立的「GitHub 仓库」页签，每个需求可关联一个仓库。支持输入 `owner/repo` 或 GitHub HTTPS 地址，指定分支、浏览目录及读取 README、源文件和配置等 UTF-8 文本。公开仓库无需 GitHub 授权；读取仍要求 CoFlow 项目成员身份。

## 使用

1. 输入仓库地址；分支留空时采用仓库默认分支，点击「连接仓库」。
2. 连接时固定提交 SHA 与根目录树；后续浏览均读取该快照。可读取可选分支，超过 100 个时继续读取下一页，也可手动输入分支。
3. 打开普通文本文件后，点击「保存为需求代码引用」。每项需求最多 50 个引用，保存仓库路径、blob/commit/tree SHA 与读取时间，不保存源文件正文。
4. 更新关联与快照需要确认。同仓库已有引用保留原提交，点击引用仍读取保存时的版本；更换仓库会清除引用。解除关联会清除所有引用。
5. 产品负责人、研发负责人和团队管理员可以维护关联及引用；其他项目成员只读。归档项目和回收站只读。已关联仓库的草稿需先解除关联再跨项目移动。

## v2.12.0：需求、验收与 PR 关联

- 项目设置中的「项目默认 GitHub 仓库」由项目内团队管理员维护，支持指定仓库和分支。需求可点击「采用项目默认仓库」保存自己的提交快照，或手动指定其他仓库。修改/移除默认值不会覆盖已有需求。采用时校验默认配置版本与仓库 ID，配置变更后须刷新重试。
- 「选择已授权仓库」按当前 GitHub 账号列出可访问的 App 安装，再选择个人/组织和仓库。安装与仓库各按 100 条分页加载；搜索明确仅覆盖已加载仓库，可继续加载。该列表按个人授权读取，不代表其他成员也有权限。
- 打开文件后可填起止行号、最多 1000 字的用途说明，关联当前验收项；起止行须同时填写且不能越界，留空表示整个文件。每份文件目前保存一个引用，可绑定一个验收项；多个文件可绑定同一验收项。验收页展示固定提交及行范围的 GitHub 链接。
- 验收项保存序号与当时的文字，后续修改或重排导致不匹配时提示重新核对，不自动关联新的文字。编辑旧引用的设置保留旧提交；「更新引用至当前快照」需确认并重新校验行范围及验收项。
- 「检查分支新提交」可检查并确认更新需求快照；「检查文件更新」比较该引用与当前分支最新提交中的 blob SHA，提示内容相同、变化、删除或类型不受支持。检查由用户发起，不自动更新快照或引用。旧提交丢失或 GitHub 不可用时可能无法再次读取历史引用；CoFlow 不存储源文件正文副本。
- 每项需求最多关联 10 个当前仓库的已有 PR，支持编号或完整 GitHub PR 地址。展示草稿/打开/关闭/合并状态、分支、head SHA、检查结果及读取时间；打开页面或点击刷新时读取，不依赖 webhook，不自动推送更新。
- 私有 PR 额外需要 **Pull requests: Read-only**，CI 额外需要 **Checks: Read-only** 和 **Commit statuses: Read-only**。修改 App 权限后须由安装管理员批准；未配置的新权限不影响原有 Contents 读取。CI 无记录、权限不足、请求失败均不能表示检查通过。每类检查展示前 100 项，超过时明确提示在 GitHub 查看完整结果；仅查询目标仓库内可见的 head 提交，fork 检查不可见时保留不可读提示，不借用 fork 权限。
- PR 合并和 CI 结果均不会修改 CoFlow 需求状态、版本、验收勾选或结论。关联操作仅保存 PR 编号，不缓存私有 PR 标题或检查正文；阅读者每次通过自己的授权读取。管理员可解除整个仓库关联，单个引用/PR 的维护须先拥有仓库读取权限。
- v2.12.0 新增 `20261020010000_github_delivery` 迁移与 ProjectGitHub 表；先生成 Prisma 客户端，再部署所有待应用迁移。旧 TaskGitHub JSON 数据保持兼容，无行范围/说明/验收项/PR 时按空值展示。ProjectGitHub 随项目物理删除清理，移除默认仓库保留递增版本，防止旧请求覆盖重新设置的值。

接口依据：[读取 PR](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)、[读取 Checks](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)、[读取提交状态](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference)。

## 私有仓库配置

管理员在 GitHub 创建 **GitHub App**，设置 Repository permissions：**Contents: Read-only**，Metadata 自动只读，不申请写入权限。启用 **Device flow**，仅为需要读取的仓库安装该应用。无需 webhook、公网回调或 GitHub App 私钥。

配置服务器环境：

```dotenv
GITHUB_APP_CLIENT_ID=<GitHub App Client ID，非 App ID>
GITHUB_APP_SLUG=<应用页面路径中的 slug>
SETTINGS_ENCRYPTION_KEY=<稳定保存的 64 位十六进制随机密钥>
```

重启 API 后，用户点击「连接 GitHub 账号」，复制设备码并在 GitHub 官方页面输入。本页按 GitHub 返回的间隔轮询，收到 slow_down 时延长间隔。设备码最多有效 15 分钟；失效或拒绝后重新申请。GitHub App 用户令牌及刷新令牌仅在后端加密保存，按用户绑定；刷新采用用户行锁串行处理。服务器须能通过 HTTPS 访问 `github.com` 与 `api.github.com`。

每位阅读者必须拥有自己的 GitHub 授权，并具备该仓库访问权，且应用也已安装并获得该仓库的 Contents 读取权限。CoFlow 不借用其他成员的 GitHub 令牌。无读取权限时，不返回代码引用路径或文件内容；关联仓库名、分支、提交和关联读取时间仍作为需求关联信息展示。

「断开账号」删除 CoFlow 本地保存的令牌与待完成授权。要撤销 GitHub 端授权，请到 GitHub Settings → Applications → Authorized GitHub Apps；调整组织仓库范围需由安装管理员处理。撤销授权、移除安装、账号失去权限或刷新失败后，读取会明确报错，重新连接或调整授权后重试。未授权的用户仍可解除自己有权维护的需求关联。

## 边界

- 固定 GitHub 官方 API 地址，禁用重定向；不接受其他服务、任意下载地址、路径穿越或带查询参数的仓库地址。
- 只读取普通 UTF-8 文本，单文件最多 1 MiB；符号链接、子模块、二进制和非 UTF-8 文件不读取。Git LFS 指针作为普通文本展示，不下载 LFS 对象。
- 目录逐层读取；GitHub 标记截断、响应超过 8 MiB 时明确拒绝，不静默显示不完整数据。空仓库没有可读取提交时会提示 GitHub 请求失败。
- 路径最多 1024 字符、32 层；单次 GitHub 请求最多 12 秒，同一次客户端读取操作累计最多约 25 秒。
- 文件以纯文本展示，不执行仓库代码，不把仓库文件当成应用指令，不自动发送至 AI 服务；本轮不包含写代码、创建 PR、MCP 或 IDE 集成。

## 升级与验证

先生成 Prisma 客户端并应用 `20261019020000_github` 迁移，再启用新前后端。新增 GitHubAccount 与 TaskGitHub 表，外键随用户/需求物理删除而清理。解绑保留单调递增的版本墓碑，避免旧请求覆盖重新建立的关联。开发与生产库未在本轮自动执行迁移。

运行 `pnpm test`、`pnpm test:integration`；独立 GitHub 浏览器场景运行 `node node_modules/@playwright/test/cli.js test -c tests/github.config.ts`。测试仅使用隔离 coflow_test 数据库，GitHub 传输模拟只存在于 tests/fixtures/github-server.ts 测试入口，生产接口不提供模拟开关。

自动化验证不能替代真实账号验收。上线前须使用真实 GitHub App 完成公开仓库、私有仓库、不同成员独立授权、安装范围调整和撤销授权检查；本轮没有配置真实 App 凭据，不能宣称已完成真实私有仓库联调。

实现依据：[GitHub App 用户令牌与设备流程](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[令牌刷新](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)、[Git trees API](https://docs.github.com/en/rest/git/trees)。
