import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function insertOnce(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`QQ-Agent 版本不兼容，无法唯一定位：${marker}`);
  return source.replace(marker, replacement);
}
export function compatibilityPlan(agentApp) {
  const appFile = path.join(agentApp, 'src', 'app.js');
  const managerFile = path.join(agentApp, 'src', 'skills', 'manager.js');
  let app = fs.readFileSync(appFile, 'utf8');
  let manager = fs.readFileSync(managerFile, 'utf8');
  const changes = [];
  if (!app.includes("getCapabilityProviders('message.command'")) {
    const marker = '    orchestrator.onIncoming(`${kind}:${id}`);';
    app = insertOnce(app, marker, `    // CoFlow command extension: consumed commands never enter the LLM.
    for (const p of skillManager.getCapabilityProviders('message.command', { chatKey: \`\${kind}:\${id}\`, kind, chatId: id })) {
      try {
        const result = p.fn({ text, senderId, kind, chatId: id, sender, store, sessions, emit, messageId: event.message_id });
        if (result?.handled) {
          Promise.resolve(result.done).catch(() => log('[command] plugin failed'));
          return;
        }
      } catch { log('[command] plugin failed'); }
    }
${marker}`);
  }
  if (!app.includes("getCapabilityProviders('schedule.tick'")) {
    const marker = '  async function start() {';
    app = insertOnce(app, marker, `  let coflowScheduleTimer = null;
  const coflowScheduledBusy = new Set();
${marker}
    clearInterval(coflowScheduleTimer);
    coflowScheduleTimer = setInterval(() => {
      for (const p of skillManager.getCapabilityProviders('schedule.tick')) {
        if (coflowScheduledBusy.has(p.skillId)) continue;
        coflowScheduledBusy.add(p.skillId);
        Promise.resolve().then(() => p.fn({ sender, store, sessions, emit, now: Date.now() }))
          .catch(() => log('[schedule] plugin failed'))
          .finally(() => coflowScheduledBusy.delete(p.skillId));
      }
    }, 30000);
    coflowScheduleTimer.unref?.();`);
    app = insertOnce(app, '  async function stop() {', '  async function stop() {\n    clearInterval(coflowScheduleTimer);');
  }
  for (const capability of ['message.command', 'schedule.tick']) {
    const start = manager.indexOf('export const MULTI_PROVIDER_CAPABILITIES = new Set([');
    const end = manager.indexOf(']);', start);
    if (start < 0 || end < 0) throw new Error('无法识别 QQ-Agent 能力注册表');
    if (!manager.slice(start, end).includes(`'${capability}'`)) manager = manager.slice(0, end) + `,\n  '${capability}'\n` + manager.slice(end);
  }
  for (const [file, content] of [[appFile, app], [managerFile, manager]]) {
    if (fs.readFileSync(file, 'utf8') === content) continue;
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: content, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('QQ-Agent 兼容补丁语法校验失败：' + result.stderr);
    changes.push({ file, content });
  }
  return changes;
}
