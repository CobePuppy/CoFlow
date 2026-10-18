# 个人设置与长期AI配置

入口：学生版或企业版侧栏「个人设置」，也可访问 /student/?section=settings 或 /enterprise/?section=settings。

- 个人资料：修改显示名称，登录邮箱只读。
- AI服务：默认DeepSeek；一次保存，当前账号所有项目及竞赛复用，不与其他账号共享。支持替换、验证、删除。留空保存不会删除旧Key。
- 使用偏好：默认模型、PPT页数、答辩时长、常用版本。新打开的FirstStep读取默认参数，可逐次调整。常用版本链接使用已保存的版本，保留现有项目深链接。
- 账号安全：当前密码验证、至少12位新密码、二次输入确认，修改后撤销其他设备会话。
- 设置使用版本号保护并发，冲突会提示刷新。所有修改要求登录及CSRF/Origin校验。

## 部署升级

执行 pnpm db:generate 和 pnpm db:migrate。Windows执行generate前需暂停API进程以释放Prisma引擎文件。
服务端环境需设置 SETTINGS_ENCRYPTION_KEY：稳定的32字节随机密钥，编码为64个十六进制字符。当前本地环境已生成；生产需独立设置，不要提交Git或输出到日志。

密钥通过AES-256-GCM加密，随机nonce并绑定用户ID。API只返回hasKey和末4位掩码；无加密配置时拒绝存储/调用。备份时单独安全保存加密主密钥，否则数据库中的Key无法恢复。更换主密钥需要迁移旧密文，当前没有自动轮换功能。

## 接口

GET /api/v1/settings：资料、偏好、版本及掩码。
PATCH /api/v1/settings：name/model/slides/minutes/preferredEdition/expectedVersion；可选apiKey替换或removeKey删除。
POST /api/v1/settings/ai/verify：空对象，仅验证当前保存的Key与默认模型。
POST /api/v1/settings/password：currentPassword/newPassword。

FirstStep run请求不包含apiKey，按当前会话用户读取加密配置。生成前仍需逐次同意资料发送与计费。没有真实用户Key，自动测试使用注入或模拟模型，不产生外部付费调用。

本地测试API端口：集成3101、QQ集成3103、浏览器3102，避免端口碰撞。数据库测试与浏览器测试使用同一隔离测试库，应顺序执行以免互相修改成员和业务数据。

验证记录：31项单元测试、2项数据库集成测试通过；类型检查、格式检查及构建通过。设置及FirstStep浏览器专项覆盖保存后刷新、无完整Key回显、验证空请求、生成请求不携带Key、失败恢复、6份文档保存和删除配置。首页与交付补跑5项通过；其他5项浏览器场景已通过，QQ未配置跳过。真实DeepSeek调用未执行。
