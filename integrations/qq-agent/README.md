# 汇流 QQ-Agent 工作助手

固定指令查询当前处理人待办，并在北京时间 09:00、18:00 私信汇总。管理员可在插件页修改提醒时刻。

## 服务器安装

本包用于已经部署的 CoFlow Windows 版与 QQ-Agent 0.4 preview / preview2。源代码目录与 Electron 的 resources/app 两种结构均支持。preview2 缺少确定性指令、定时扩展点时，安装器只追加相应调用与能力注册；不替换整个 QQ-Agent。未知版本无法定位代码时停止安装。

1. 将部署 ZIP 解压到服务器的临时更新目录。不要覆盖 CoFlow 的数据库、storage 或 QQ-Agent 的 data。
2. 停止 CoFlow API，并完全退出 QQ Agent（含托盘）；PostgreSQL 保持启动。使用实际运行程序的 Windows 用户执行。
3. 打开 PowerShell，将以下 `CoFlowRoot` 改为服务器实际 CoFlow 根目录。先预检，再安装：

```powershell
.\Install-CoFlowQQ.ps1 -CoFlowRoot 'D:\CoFlow' -AgentRoot 'C:\Users\hp-pcz\AppData\Local\Programs\QQ Agent' -VerifyOnly
.\Install-CoFlowQQ.ps1 -CoFlowRoot 'D:\CoFlow' -AgentRoot 'C:\Users\hp-pcz\AppData\Local\Programs\QQ Agent'
```

只有一个团队时自动选择；多个团队时加 `-WorkspaceId '团队UUID'`，安装器会列出可选团队。多实例或自定义数据目录时，显式加 `-AgentDataDir '实际 data 目录'`。仅支持同机自动安装；机器人接口自动使用 loopback 与 CoFlow .env 的 PORT。

`-WebUrl 'https://实际公网地址'` 决定 QQ 消息中的任务链接。默认复用 `QQ_BOT_WEB_URL` 或 `APP_ORIGIN`，请确保收件人可以访问。浏览器的 APP_ORIGIN 保持不变。跨机器手动配置插件时必须使用 HTTPS。

安装器校验 SHA-256、检查目标路径、备份所有将覆盖的文件、生成或复用专用令牌、限定团队、更新前后端与 Prisma 客户端、执行增量迁移，并启用插件。令牌只写入 CoFlow .env 与 QQ-Agent 实际配置，不打印在终端。重复安装保留令牌和绑定关系；安装失败自动恢复已备份文件，成功执行的增量数据库迁移保留。

4. 使用原有方式启动 CoFlow 与 QQ Agent，再验证：

```powershell
.\Verify-CoFlowQQ.ps1 -CoFlowRoot 'D:\CoFlow'
```

QQ-Agent 控制台不是 3210 端口时加 `-AgentPort 实际端口`。该步骤验证 CoFlow 健康、机器人接口鉴权和 QQ-Agent 插件 active 状态，不发送消息。

5. 登录汇流 → 成员管理 → 我的 QQ 工作提醒 → 生成绑定码。将 `/工作 绑定 <码>` 私信给机器人，回平台刷新确认，再私信 `/工作`。机器人必须已登录，并能向该 QQ 私信（通常需添加好友）。最后将提醒时刻暂设为接下来一分钟，验证收到一次私信；随后恢复 `09:00,18:00`。

## 使用

| 指令 | 内容 |
| --- | --- |
| `/工作 [页码]` | 当前阶段需要本人处理的工作 |
| `/工作 全部 [页码]` | 本人参与且未结束的工作 |
| `/工作 逾期 [页码]` | 当前待办中逾期的工作 |
| `/工作 帮助` | 使用说明 |
| `/工作 绑定 <码>` | 私信绑定，10 分钟有效，一次性使用 |

群内查询时详情只私信本人，群里只回发送结果。绑定码不接受群内提交；误发到群后请在平台撤销并重建。解绑和撤销待绑定码均在成员管理完成。

待办沿用平台阶段处理人规则，含需求草稿；已完成本轮方案评估的人不会继续收到该轮评估提醒。已关闭、已取消、归档项目及无项目权限的任务不进入待办。阻塞任务仍展示并标记。查询每页 8 条，定时提醒只发第一页并标明总数，可发指令查看更多。

只有有待办的已绑定成员收到定时私信。发送前查询最新权限和工作，不补发停机时段。去重记录位于实际 DATA_DIR/plugins/coflow/reminders.json；同一提醒时段串行执行，每人最多尝试 3 次，仅在配置的分钟内重试。发送前落盘 reservation；进程在 reservation 与发送之间崩溃可能漏发该时段，这是避免不确定发送重复刷屏的取舍。QQ 服务不提供 exactly-once 保证，跨多条消息的部分发送失败仍可能产生部分重复。只允许一个机器人进程使用同一数据目录。

禁用插件停止新的查询和推送；已经进入 QQ-Agent 发送队列的消息不会撤回。损坏的提醒记录会停止本轮提醒并记日志，不能通过清空记录自动恢复而造成重复。

## 故障与回滚

插件页确认 coflow 为已加载、已启用、生效，能力包含 message.command 和 schedule.tick。私信失败先检查机器人登录、好友关系和发送限额。401 检查令牌一致；503 检查 .env 的 QQ_BOT_TOKEN（至少 32 字符）与 QQ_BOT_WORKSPACE_ID；404 检查绑定和当前团队。权限、负责人转交和解绑在下次查询立即重算；已在发送队列中的消息存在短暂窗口。

安装日志会打印备份目录。回滚前停止两端程序，然后：

```powershell
.\Rollback-CoFlowQQ.ps1 -CoFlowRoot 'D:\CoFlow' -BackupDir 'D:\CoFlow\backups\qq-integration-实际时间' -AgentRoot 'C:\Users\hp-pcz\AppData\Local\Programs\QQ Agent'
```

自定义数据目录时回滚也传 `-AgentDataDir`。回滚恢复代码与配置，保留新增数据库表和绑定数据，不删除业务记录。不要在安装后修改了其他配置的情况下直接覆盖恢复，先比对备份。

## 开发与打包

源码位于 integrations/qq-agent。执行 `pnpm db:generate`、`pnpm build` 后运行 `node integrations/qq-agent/package.mjs`，输出 artifacts/coflow-qq-integration；用 PowerShell Compress-Archive 打包其内容。包内没有数据库、令牌和 QQ 登录会话。

机器人接口为 `/api/v1/integrations/qq/{bind,work,recipients}`；浏览器绑定接口为 `/api/v1/workspaces/:id/qq-binding` 及 `/code`，受已有登录、CSRF 和团队成员检查保护。专用机器人令牌仅用于本团队绑定和待办读取，不能修改任务。当前部署只接入一个团队，需要轮换令牌时同步修改两端配置并重启。

## 1.1 设置中心整合

个人设置→QQ与团队集成可绑定QQ，并由管理员保存团队策略。插件填写workspaceId为团队ID，启用syncPolicy从CoFlow同步提醒时刻；本地pushEnabled仍须开启。网页配置优先于环境变量，团队令牌仅存摘要，替换后同步到插件。未提供workspaceId时仍兼容旧单团队环境变量。页面状态不表示机器人在线。详见docs/15-QQ设置整合与操作按钮美化.md。
