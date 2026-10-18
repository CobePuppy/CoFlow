import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BusinessError } from './domain.js';
export function encryptionReady() {
  return /^[a-f0-9]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY || '');
}
function key() {
  if (!encryptionReady())
    throw new BusinessError(503, '管理员尚未配置密钥加密服务');
  return Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, 'hex');
}
export function encryptKey(value: string, userId: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString('base64url'))
    .join('.');
}
export function decryptKey(value: string, userId: string) {
  const secret = key();
  try {
    const [iv, tag, encrypted] = value
      .split('.')
      .map((x) => Buffer.from(x, 'base64url'));
    const cipher = createDecipheriv('aes-256-gcm', secret, iv);
    cipher.setAAD(Buffer.from(userId));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new BusinessError(
      503,
      '无法解密已保存的Key，请联系管理员检查加密配置',
    );
  }
}
