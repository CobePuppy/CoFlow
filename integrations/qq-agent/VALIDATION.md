# 验证与部署状态（2026-10-16）

## 已完成

- CoFlow 浏览器 QQ 绑定界面、会话/CSRF 保护、10 分钟一次性码、主动解绑与撤销。
- 机器人专用令牌与团队限定；任务按当前处理人、有效团队/项目成员和未归档项目计算。
- QQ-Agent 固定指令、私信回复、北京时间定时汇总、持久化去重、失败有限重试和禁用生命周期。
- Windows 安装预检、逐文件 SHA-256、备份、增量迁移、失败恢复、重复安装、独立回滚与安装后验证脚本。
- preview / preview2 接入差异已验证，preview2 只补充两个扩展点及多提供者注册。

## 实际执行

- `pnpm db:generate`：通过。
- `pnpm typecheck`、`pnpm lint`：通过。
- `pnpm test`：11 项通过，包含实际 HTTP 插件测试与两版 QQ-Agent 兼容补丁测试。
- `pnpm test:integration`：2 项通过，使用独立 coflow_test PostgreSQL，含原有全流程回归和 QQ 绑定/并发/失效/隔离测试。
- `pnpm build`：通过；保留已有依赖的 use-client 与大包提示。
- 单独启用测试 QQ 配置运行 `tests/e2e/qq.spec.ts`：1 项通过，桌面/390px 页面、生成绑定、机器人接口兑换、刷新、解绑；截图见 artifacts/browser/qq-binding-*.png。
- `pnpm test:e2e`：原有 5 项浏览器场景全部通过；QQ 专用场景因默认未启用机器人配置在本轮跳过，已在上一步单独通过。
- 隔离目录 artifacts/qq-deploy-smoke：实际安装、生产构建的健康/前端/鉴权验证、真实 QQ-Agent 加载器加载与令牌脱敏、重复安装预检/安装、文件回滚均通过。没有调用真实 QQ 发送接口。
- PowerShell 安装、验证、回滚脚本语法检查通过；回滚在隔离目录实际执行并核对了原配置/源码及插件文件恢复。
- 插件源码已放入本地 QQ-Agent 0.4 preview/plugins/coflow，默认关闭；没有更改 QQ 账号配置或启动机器人。

## 尚需服务器条件

服务器 10.16.7.124 已通过 Users 文件共享连接，实际 CoFlow 根目录为 C:\Users\hp-pcz\AppData\Local\Programs\CoFlow。QQ-Agent 已具有 message.command 与 schedule.tick 扩展点，配置位于安装根目录的 data/config.json。更新文件及一键安装/验证入口通过共享交付；尚未在服务器执行安装、迁移和重启。

部署包为 artifacts/CoFlow-QQAgent-1.0.0.zip，独立插件 ZIP 为 artifacts/coflow-qq-agent-plugin-1.0.0.zip。实机部署后必须由本人绑定 QQ，并在已登录、可私信的机器人上验证 `/工作` 和一次定时提醒。未将隔离安装演练或模拟发送器测试视为真实 QQ 消息送达验收。
