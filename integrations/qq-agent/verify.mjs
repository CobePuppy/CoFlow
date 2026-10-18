import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const args = process.argv.slice(2);
const root = path.resolve(args[0] || '.');
const require = createRequire(path.join(root, 'package.json'));
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const base = `http://127.0.0.1:${Number(env.PORT || 3001)}`;
async function get(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`接口验证失败：HTTP ${r.status}`);
  return r.json();
}
try {
  if (!(await get(base + '/api/v1/health')).ok) throw new Error('CoFlow 健康检查失败');
  const recipients = await get(base + '/api/v1/integrations/qq/recipients', { Authorization: `Bearer ${env.QQ_BOT_TOKEN}` });
  if (!Array.isArray(recipients.items)) throw new Error('机器人接口响应异常');
  const skillResponse = await get(`http://127.0.0.1:${Number(args[1] || 3210)}/api/skills`);
  const skills = Array.isArray(skillResponse) ? skillResponse : skillResponse.skills || skillResponse.items;
  const plugin = skills?.find(s => s.id === 'coflow');
  if (!plugin?.loaded || !plugin.enabled || !plugin.active) throw new Error('QQ-Agent 插件未加载或未启用，请检查插件页与实际数据目录');
  for (const capability of ['message.command', 'schedule.tick']) if (!plugin.implementedCapabilities.includes(capability)) throw new Error('插件缺少能力：' + capability);
  console.log(`PASS：CoFlow 数据库、机器人鉴权、QQ-Agent 插件加载与两项能力。当前已绑定 ${recipients.items.length}${recipients.nextCursor ? '+' : ''} 人；未发送真实 QQ 消息。请完成本人绑定并私信 /工作 作最终端到端验收。`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
