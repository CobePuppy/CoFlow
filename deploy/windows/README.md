# 汇流 Windows 部署准备

目标：10.16.7.124，使用独立全新 PostgreSQL 数据库。不要执行 db:seed，它会创建演示账号。

1. 使用 Node.js 24、pnpm 11 与 PostgreSQL 17/18。将项目放入独立目录，不能覆盖服务器已有应用。
2. 创建专用 PostgreSQL 用户与空数据库，数据库仅监听本机。复制本目录 `.env.production.example` 到项目根目录 `.env`，填写真实连接信息。数据库密码和服务器登录密码分别配置。
3. 在项目根目录执行 `pnpm install --frozen-lockfile`、`pnpm db:generate`、`pnpm db:migrate`、`pnpm build`。
4. 设置本次进程的 `BOOTSTRAP_EMAIL` 和 `BOOTSTRAP_PASSWORD`（至少12位），执行 `node --import tsx scripts/bootstrap.ts`，完成后清除这两个进程环境变量。初始化脚本只允许空数据库，不覆盖已有用户。
5. 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File deploy/windows/Start-CoFlow.ps1`。程序在同一端口提供前端与 API，不使用 Vite 开发服务器。
6. 为 8080 端口设置内网范围的防火墙规则；确认端口未被其他应用占用。访问 `http://10.16.7.124:8080` 和 `/api/v1/health` 验证。
7. 完成首次登录、创建项目、邀请成员及附件上传下载验证后，再注册专门的 Windows 服务或开机任务。注册方式取决于服务器账号权限；不得修改其他应用的启动任务。

成员注册：管理员进入“成员管理→邀请与角色管理”，填写成员邮箱并生成邀请链接；成员打开链接注册。当前不自动发邮件，请自行复制链接。管理员创建项目后，为成员配置项目访问权限；任务职责可自由分配。

10.16.7.124 为内网地址，内网使用不必先购买域名。公网访问还需可达的公网入口或网络映射，并配置域名与 HTTPS；不能把公网 DNS 直接指向该内网地址期待公网访问。

当前示例为内网 HTTP，`COOKIE_SECURE=false` 仅用于此场景。改用 HTTPS 后设为 true，并将 APP_ORIGIN 改成实际 HTTPS 域名。不要把 .env、初始化密码、数据库或附件放入前端 dist 目录。

## 两个版本入口

同一部署提供/enterprise/（企业版）和/student/（学生版），旧根路径兼容企业版。内置服务器支持两种入口的深链刷新；API保持根路径/api/v1，静态资源保持/assets。APP_ORIGIN填写站点来源（协议、主机及端口），不附加版本路径。当前两版共用本实例的账号、团队与项目权限；需要完全隔离时使用独立部署、数据库和附件目录。升级需执行db:generate与db:migrate，以应用202610170002_student_competitions。
