汇流 CoFlow — 服务器使用说明

日常启动
双击根目录 CoFlow.exe。运行期间保持服务窗口打开。
当前访问地址：http://workspace.coflow.top
NATAPP 隧道也必须保持运行。若你在其他位置手动启动了 NATAPP，请继续使用原客户端，不要同时运行相同令牌的两个客户端。

tools：辅助工具
Configure-Public-CoFlow.cmd：配置官方 NATAPP 客户端、令牌与 HTTPS。仅在需要配置时使用；会先检查公网 HTTPS，通过后才修改网站地址。
Start-Public-CoFlow.cmd：同时启动已在本工具中配置好的 NATAPP 与 CoFlow。没有完成 Configure-Public-CoFlow 时请使用原 NATAPP 客户端和根目录 CoFlow.exe。
Repair-CoFlow-Runtime.cmd：修复微软 Visual C++ 运行库，仅故障排查时使用。
其他 .ps1 是上述工具依赖的脚本，不必手动运行。

archives：保留的历史文件
installers：首次部署安装包与脚本备份。
logs：运行库安装日志。
docs：旧版部署说明。
config-backups：原网站配置备份，包含数据库连接信息，请勿公开分享。
organization-*.json：本次文件移动清单，供维护时恢复。

运行必需文件
apps、deploy、node_modules、prisma、runtime、scripts、updates、.data、.env 等已设置为隐藏，原路径未变。
在资源管理器中开启“显示隐藏的项目”可查看。不要删除或移动这些文件。
数据库位于 .data\postgres，附件位于 storage（上传附件后创建）。备份时保留 .env、.data 和 storage。

重启网站
关闭原 CoFlow 服务窗口后再双击 CoFlow.exe。只关闭浏览器不会重启服务。
当前 HTTP 域名配置已保留。以后启用 HTTPS 时需同步修改 APP_ORIGIN 与 COOKIE_SECURE。
