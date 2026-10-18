// getRandomValues is available on HTTP origins where randomUUID is not.
export function createClientId(
  source: Pick<Crypto, 'getRandomValues'> &
    Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto,
): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  if (typeof source?.getRandomValues !== 'function')
    throw new Error('浏览器不支持安全随机数，请升级浏览器后重试');
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
