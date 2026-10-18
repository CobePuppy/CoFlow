# HTTP访问下操作按钮无响应修复

问题：页面直接使用crypto.randomUUID生成请求幂等键和本地标识。该方法在非安全HTTP上下文可能不可用。需求操作begin在setAction之前调用它，异常会阻断确认框；属性start先打开浮层，再调用该方法，异常会阻止给下拉框赋值，与“弹窗空白/点击推进无响应”的现象吻合。

修复：统一createClientId，原生randomUUID存在时沿用，不存在时使用HTTP环境可用的getRandomValues生成UUID v4。仍使用安全随机数，不使用固定值或Math.random。同步替换需求动作、属性操作、FirstStep成果保存及项目分身中的直接调用。业务权限、幂等和阶段校验保持原规则。

验证：新增HTTP能力缺失单元测试；浏览器回归显式禁用randomUUID，四项通过：属性选项保存取消与窄屏、多角色完整交付、缺陷失败与重测交付、需求表单及导航。46项单元测试、类型检查、生产构建及格式检查通过。无后端或数据库迁移变化，构建日志artifacts/http-actions-build.log。
