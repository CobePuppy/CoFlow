import {
  decryptKey,
  encryptionReady,
} from '../../infrastructure/security/encryption.js';

import 'dotenv/config';
import 'reflect-metadata';

import { assert } from '../requirements/domain.js';

import { db } from '../../shared/access.js';
async function savedCredentials(userId: string) {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  assert(settings?.encryptedKey, '请先在个人设置中保存DeepSeek API Key', 422);
  return {
    apiKey: decryptKey(settings.encryptedKey, userId),
    model: settings.model as 'deepseek-flash' | 'deepseek-v4-pro',
  };
}
async function settingsView(userId: string) {
  const v = await db.userSettings.findUnique({ where: { userId } });
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return {
    ...user,
    model: v?.model || 'deepseek-flash',
    slides: v?.slides ?? 12,
    minutes: v?.minutes ?? 8,
    preferredEdition: v?.preferredEdition || 'student',
    version: v?.version ?? 0,
    hasKey: !!v?.encryptedKey,
    keyHint: v?.keyHint || '',
    encryptionReady: encryptionReady(),
  };
}
export { savedCredentials, settingsView };
