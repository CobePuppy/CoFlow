import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../../apps/api/src/modules/proofloop/export.js';

/** Integrity only: a matching hash is not evidence that project claims are true. */
export function verifyProofFile(value: any) {
  if (
    value?.digestAlgorithm !== 'SHA-256' ||
    value?.payload?.format !== 'coflow-proofloop/v1' ||
    !Array.isArray(value.payload.documents) ||
    !/^[a-f0-9]{64}$/.test(value.digest || '')
  )
    return false;
  if (
    createHash('sha256').update(canonicalJson(value.payload)).digest('hex') !==
    value.digest
  )
    return false;
  return value.payload.documents.every(
    (d: any) =>
      !!d &&
      typeof d.content === 'string' &&
      createHash('sha256').update(d.content).digest('hex') === d.contentSha256,
  );
}
export async function runProofVerifier(file = process.argv[2]) {
  try {
    if (!file) throw new Error();
    const pack = JSON.parse(await readFile(file, 'utf8'));
    if (!verifyProofFile(pack)) throw new Error();
    console.log(
      '证据包摘要及文书正文哈希一致。这仅验证文件完整性，不证明主张真实。',
    );
  } catch {
    console.error('证据包校验失败：请检查文件路径、格式、摘要及文书内容。');
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runProofVerifier();
