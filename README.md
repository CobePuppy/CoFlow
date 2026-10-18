# 汇流（CoFlow）

项目分身已加入：需求协作 → 项目分身，为同一决策建立两条限时探索路线，独立记录试验、预算和成果，在决策桌比较实际结果并保留选中成果。使用方法、迁移及边界见 [项目分身与决策桌](docs/16-项目分身与决策桌.md)。

QQ-Agent 工作助手接入已实现：成员管理中绑定本人 QQ，私信 `/工作` 查询当前待办，按北京时间 09:00/18:00 汇总提醒。接入需要安装更新并配置团队与专用令牌；未配置时不启用。安装、验证和回滚见 [QQ-Agent 接入说明](integrations/qq-agent/README.md)。

面向产品、研发、测试/运维的团队协作平台。交付主线是：提交需求 → 研发方案 → 产品与测试分别评估 → 开发 → 提测 → 测试 → 产品验收关闭。

**当前进度：前后端已联通，腾讯 Ardot 设计已落地，核心流程验证通过。** 已完成工作台、阶段看板、任务详情及窄屏导航。设计文件：https://ardot.tencent.com/file/736835039928511 。当前实现边界见文末。

## 环境及启动

使用 Node.js 24、pnpm 11、PostgreSQL 17 或 18。Windows、macOS、Linux 均可使用 Docker Compose 启动数据库；也可以使用本机 PostgreSQL。依赖版本由 `pnpm-lock.yaml` 锁定，`pnpm-workspace.yaml` 明确允许 Prisma、Argon2、esbuild 的必要构建脚本。

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

首次运行前编辑 `.env`，确认 `DATABASE_URL` 指向自己的开发数据库，并设置至少 12 位的 `SEED_PASSWORD`。仅首次创建演示账号时使用此密码，重复种子不会重置已有密码。不要将真实凭据提交到版本库。

Web 地址为 `http://localhost:5173`，API 为 `http://127.0.0.1:3001/api/v1`，数据库健康检查为 `/api/v1/health`。浏览器请使用 `localhost:5173`，与 `APP_ORIGIN` 一致。开发期 Vite 同源代理 `/api`；Cookie 会话配合 CSRF token 与 Origin 校验。

当前这台机器已单独初始化 `.local-pg`，监听 `127.0.0.1:55432`，本地 `.env` 已配置好。此实例独立于机器原有 PostgreSQL 服务；它是忽略的本地运行数据，不属于交付源码。需要重新启动时可使用本机 PostgreSQL `pg_ctl -D <项目绝对路径>/.local-pg -o "-p 55432 -h 127.0.0.1" start`。切换到 Docker 时请先确认端口和 `.env`，不要同时对同一端口启动两个实例。

只启动 API：`pnpm --filter @coflow/api dev`。API 会从仓库根目录读取 `.env`，附件相对目录也相对于仓库根目录。构建 API：`pnpm --filter @coflow/api build`；启动构建产物：`pnpm --filter @coflow/api start`。完整前后端构建：`pnpm build`。

## 本地演示账号

| 邮箱 | 角色 |
| --- | --- |
| product@coflow.local | 林悦，团队管理员、产品负责人及产品评估人 |
| engineer@coflow.local | 陈宇，研发 |
| qa@coflow.local | 苏宁，测试及测试评估人 |
| ops@coflow.local | 周远，运维 |
| other@coflow.local | 第二个隔离团队的管理员、产品 |
| other-engineer@coflow.local | 第二个团队的研发 |
| other-qa@coflow.local | 第二个团队的测试 |
| other-ops@coflow.local | 第二个团队的运维 |

密码为首次种子执行时的 `SEED_PASSWORD`。以上账号和密码仅供本地演示，不用于生产。

种子包含全部业务阶段，以及方案退回、测试失败、需求变更和阻塞案例。种子按团队和任务标题检查已有记录，重复执行补充缺失案例，不清空任务、覆盖历史或重置密码。已有任务标题若被人工改名，再执行可能补充同名基线案例。

## 中文协作首页

登录后默认进入“工作台”，以浅灰侧栏、白色主区和两列应用目录呈现；应用页支持搜索、分类与本机收藏。新增页面由本地 React 实现，参考用户提供的应用目录截图，平台名称统一使用“汇流”。

- 成员管理：查看团队成员、邀请伙伴、管理团队身份及选定项目的角色。
- 项目管理：查看、搜索、创建项目，进入原有需求协作流程及归档设置。
- 知识库：按项目管理版本化文档和文件；支持独立上传、搜索和受权限保护的下载，也展示需求附件。项目归档后只读。当前尚无文件夹和文件重命名功能。

`/?section=apps` 为应用目录，`/?app=work` 为需求工作台；原有 `/?task=<id>` 直达链接继续有效，工作台可返回首页。首页地址中的 `workspace` 仅用于选择团队，实际访问权限仍由 API 校验。

数据库迁移 `202610160004_project_files` 允许文件不关联任务，并补充项目与团队的复合外键；已有附件保持原有任务关联。新增 `GET/POST /api/v1/projects/:id/attachments`，上传复用原有 20 MB 限制、文件签名校验和事务保护。独立项目文件与任务附件使用相同存储、备份和孤儿文件清理机制。

首页浏览器场景位于 `tests/e2e/portal.spec.ts`，截图保存在 `artifacts/browser/portal-*.png`。原有三个交付场景已适配登录后首页。

## 后端能力

- 服务端会话、Argon2id 密码、退出及会话到期、登录限流、CSRF 与 Origin 校验。
- 团队及项目隔离、一次性邀请链接、受邀注册、团队身份及项目角色管理、责任转交、归档只读。
- 需求草稿与不可变提交版本、方案草稿/版本、双人独立评估、完整业务动作及取消。
- 乐观锁、24 小时以上保留的幂等记录、项目级事务串行化；状态、历史、审计与通知同事务提交。
- 开发交接、独立测试轮次、失败关联缺陷、阻断缺陷关闭检查、逐项验收、需求变更后审批失效。
- 阻塞、评论与项目成员提及、受保护的本地附件、站内通知、Markdown 文档与历史、统一时间线和阶段统计。
- 数据库复合外键、历史追加保护及归档写入保护。

动作请求必须带 `Idempotency-Key`、`X-CSRF-Token` 和 `expectedVersion`。任务详情返回 `handlerIds` 与 `allowedActions`，前端应据此展示操作。业务状态不通过 PATCH 修改。接口说明见 `docs/03-后端接入说明.md`。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
```

集成测试只允许显式配置的 **coflow_test** 数据库。先创建这个独立空库；Docker 示例：

```powershell
docker compose exec postgres createdb -U coflow coflow_test
pnpm test:prepare
pnpm test:integration
```

`.env` 中的 `TEST_DATABASE_URL` 必须与开发库不同。`test:prepare` 只迁移并补充种子，不清空数据。测试账号默认密码为 `CoFlow-test-only-2026!`，可用 `TEST_SEED_PASSWORD` 在首次创建前覆盖。集成测试自行启动 3101 端口的 API，附件单独放在 `storage-test/`，创建新的验证数据并保留记录。测试中的事务故障注入仅发生在测试库，结束后移除注入触发器。

目前实际通过：8 个单元测试；真实 PostgreSQL API 集成测试（覆盖正常交付、测试退回、评估退回、并发双评估、幂等、权限隔离、需求变更、成员转交、邀请注册、附件、评论通知、文档冲突、事务失败回滚及数据库历史保护）。类型检查、格式检查、完整构建通过。4 个浏览器场景通过：正常多角色交付、测试失败关联缺陷后再次交付、新建表单与看板及窄屏导航，以及中文首页/收藏/项目成员/独立文件库与跨团队下载隔离。执行命令为 `pnpm test:e2e`；需要先安装 Playwright Chromium。截图位于 `artifacts/browser/`。构建仍有主包体积较大的提示，后续可按路由拆包。

## 附件与清理

`STORAGE_DIR` 默认是仓库根目录下的 `storage/`。文件随机命名，下载必须经过当前团队/项目权限校验；上传最大 20MB，允许 PNG/JPEG/PDF/UTF-8 TXT/DOCX/XLSX/ZIP，并校验 MIME、签名和 Office 容器目录。ZIP 不解压、不执行。

文件先以临时文件写入，再改名并记录元数据，失败时清理文件。服务崩溃造成的无引用文件由 `pnpm storage:cleanup` 只读列出；确认后 `pnpm storage:cleanup --apply` 清理。只处理超过 24 小时的随机存储文件，避免干扰进行中的上传。草稿删除后的文件也通过此机制清理。

## 备份与隔离恢复

先停止 API 写入，再备份数据库和附件，确保两者一致。需要本机 PostgreSQL 的 `pg_dump` 与 `pg_restore`；不在 PATH 时设置 `PG_BIN`。备份含账号摘要与业务数据，保存在已忽略的本地目录，需要自行妥善保管。

```powershell
$env:PG_BIN='C:\Program Files\PostgreSQL\18\bin'
$env:BACKUP_DIR='D:\backups\coflow-20261016'
pnpm backup
```

备份包含 PostgreSQL 自定义格式转储、附件和 SHA-256 清单。恢复演练必须使用独立的空库，名称为 `coflow_restore` 或 `coflow_restore_<字母数字后缀>`，并指定一个尚不存在的附件目录。脚本拒绝覆盖开发库、测试库、非空目标库及已有附件目录，不执行清空操作。

```powershell
$env:RESTORE_DATABASE_URL='postgresql://coflow:coflow_local@localhost:5432/coflow_restore'
$env:RESTORE_STORAGE_DIR='D:\restore\coflow-20261016-files'
pnpm backup:verify
```

`BACKUP_DIR` 指向之前的备份；目标数据库需提前创建。脚本恢复后核对任务数、附件元数据数与文件校验和。不要将演练地址直接切换为生产配置。

## 实现边界与待办

需求/方案/审批/开发/测试等任务内记录暂以 Task JSONB 聚合存储，并用事务、条件更新和数据库触发器保护历史；不是文档最初列举的每种记录一张独立表。索引及复合外键通过版本化 SQL 迁移维护；请使用 `db:migrate`，不要使用 `prisma db push` 覆盖手写约束。NestJS 提供 HTTP 宿主，HTTP 路由按领域区分，状态机、输入校验与存储检查已分离；尚未拆成全部独立 Nest 模块。详见技术文档的实施修订。

阻断缺陷目前必须关闭才能放行，不提供产品/测试联合降级界面。任务筛选在项目范围读取后处理，适用于小团队 MVP，数据量扩大后需改成完整 SQL 筛选。幂等记录超过 24 小时仍保留，尚未增加定期清理任务。登录限流为单进程内存实现，重启会重置。附件未接入云存储及病毒扫描。没有生产部署、真实邮件或外部通知。

前端已参考用户提供的 `pythc/cobuild-homepage` 和 `pythc/110lab-website`，具体资源分析、页面要求及 Ardot 提示词见 `docs/04-前端设计交接.md`。Ardot 原生画板、变量和截图索引见 `artifacts/design/manifest.json`；看板使用动作按钮推进，尚未开放拖拽。




## 2026-10-17 可靠性迭代

本轮已改进接口异常响应处理、收藏缓存容错，并将 Markdown 渲染按需加载。16 项单元测试、类型检查、格式检查和构建通过；首轮浏览器回归曾因本地数据库未启动而未完成，后续已恢复并完成验证，见下节。问题复盘、优先级和验证边界见 [项目复盘与迭代记录](docs/06-项目复盘与迭代.md)。

## 页面与知识库迭代

本地数据库预检：pnpm db:local:status；启动已有项目实例：pnpm db:local:start。需求工作台、首页、文档、管理页面已按需加载；知识库支持文件来源筛选，文档关联任务支持完整分页及标题搜索。新功能规划、构建数据与验证边界见 [新功能与前端优化路线](docs/07-新功能与前端优化路线.md)。

## 文档与需求双向关联

需求详情新增关联文档页签；文档内可查看关联需求编号、标题与状态并跳转，支持复制文档直达链接和刷新恢复。入口沿用项目权限，归档仍只读。使用方式、新接口与后续功能建议见 [文档需求双向关联](docs/08-文档需求双向关联.md)。

## 前端交互与状态逻辑更新

任务视图、筛选和页码统一保存在 URL；进入详情再返回可保持列表位置，切换团队/项目清理旧上下文。看板支持每页100条翻页，筛选控件支持统一清空，加载/失败/空结果反馈已区分。总结及下一步方向见 [前端交互与状态逻辑更新](docs/09-前端交互与状态逻辑更新.md)。

## 需求模板中心

项目页新增需求模板，管理员和项目产品成员可创建、编辑和停用；成员创建需求时可套用已启用模板，也可将草稿内容保存为模板。模板仅复用需求内容，不复制负责人、截止日期或流程历史。新增数据库迁移202610170001_requirement_templates，其他环境升级前需生成客户端并部署迁移。使用说明与更多企业应用候选见 [需求模板中心与企业应用规划](docs/10-需求模板中心与企业应用规划.md)。

## 企业版与学生版

企业版入口为/enterprise/，学生版入口为/student/，旧根网址兼容企业版。学生版包含需求、项目、竞赛管理、文书中心与知识库，支持竞赛登记及计划书、结题报告、答辩提纲等结构草稿。当前共用账号、团队及服务端项目权限，路径不代表独立数据隔离。本地已应用新增竞赛迁移；其他环境升级前请生成客户端并部署迁移。网址、能力边界和部署说明见 [企业版与学生版](docs/11-企业版与学生版.md)。

## FirstStepAgent 竞赛启动助手

学生版竞赛卡片新增FirstStepAgent：无Key可预览提示词；用户提供自己的DeepSeek API Key并确认后，可生成竞赛分析、开发提示词、技术栈文档、PPT提示词、分工计划和提交清单。Key在个人设置中加密长期保存，跨竞赛复用，生成结果核对后可保存为6份项目文档。完整引导、计费与资料发送范围见 [FirstStepAgent说明](docs/12-FirstStepAgent竞赛启动助手.md)。

## ProofLoop 成果验证闭环

学生版竞赛卡片新增ProofLoop：登记主张与评分/验证条件、关联文书原文及版本、发现跨文书矛盾、转为项目补证任务。个人AI配置复用；模型疑点必须有两份不同文书的逐字引用。

在基础版本之上完成三轮迭代：预算内的补证优先建议、绑定证据内容的署名人工核对、可导出和校验完整性的交接证据包。支持源文书变化后标记过期；任务完成不会自动证明主张成立。升级需执行迁移202610170004_proofloop并生成Prisma客户端。使用说明、边界与逐轮验证见 [ProofLoop与三轮迭代](docs/14-ProofLoop成果验证与三轮迭代.md)。

个人设置新增QQ与团队集成，提供个人绑定和管理员策略配置；按钮操作统一浅底圆角、图标、焦点及窄屏样式。配置与复查结果见 [QQ设置与按钮美化](docs/15-QQ设置整合与操作按钮美化.md)。机器人策略同步需部署1.1.0插件，兼容旧单团队环境变量配置。
