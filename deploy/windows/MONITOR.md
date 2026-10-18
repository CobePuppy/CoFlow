# 服务器监控台

在服务器安装目录双击 `CoFlow-Monitor.exe`，查看每 3 秒刷新的健康状态、数据库 TCP 连通性、API 进程 PID、工作集内存、运行时间和部署版本，以及 API / PostgreSQL 最近日志。

健康检查调用 `/api/v1/health`，其中执行真实的数据库 `SELECT 1`；数据库 TCP 连通性单独展示，端口可连接不代表查询成功。响应时间为健康检查耗时。进程信息仅匹配本安装目录的 Node 与 API 入口。日志尾部最多读取每文件 12 KB，连接信息及常见密钥字段会遮盖；原始日志仍须按服务器敏感文件管理。

监控台不启动或停止 API，不监听新端口，关闭窗口不影响网站。网站通过远程方式在后台运行时，也可以随时打开监控台。打开网站、安装目录和日志目录均使用服务器本机桌面。

开发构建：使用 .NET Framework 4 C# 编译器，引用 `System.Windows.Forms.dll`、`System.Drawing.dll`、`System.Management.dll` 和 `System.Web.Extensions.dll`，目标为 `winexe`。将编译结果放在 CoFlow 根目录；不依赖安装额外运行库。

诊断：`CoFlow-Monitor.exe --check` 将实际检查结果写入 `updates/monitor-check.json`，退出码 0 表示健康检查通过。`--root` 可以指定安装目录。
