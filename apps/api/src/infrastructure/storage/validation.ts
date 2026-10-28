import path from 'node:path';
import { assert } from '../../modules/requirements/domain.js';
const types: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};
// Inspect ZIP central directory without extracting or executing content.
function zipEntries(b: Buffer): string[] {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  assert(end >= 0, 'ZIP 中央目录缺失');
  const count = b.readUInt16LE(end + 10),
    offset = b.readUInt32LE(end + 16),
    size = b.readUInt32LE(end + 12);
  assert(count <= 10000 && offset + size <= end, 'ZIP 目录无效或过大');
  let p = offset;
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    assert(p + 46 <= end && b.readUInt32LE(p) === 0x02014b50, 'ZIP 目录损坏');
    const n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32);
    assert(p + 46 + n + extra + comment <= end, 'ZIP 条目损坏');
    names.push(b.subarray(p + 46, p + 46 + n).toString('utf8'));
    p += 46 + n + extra + comment;
  }
  return names;
}
export function validateFile(f: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}) {
  assert(f.size > 0 && f.size <= 20 * 1024 * 1024, '附件必须为 1 字节至 20MB');
  // Browser multipart filenames use UTF-8; Busboy falls back to Latin-1.
  let originalname = f.originalname;
  if ([...originalname].every((c) => c.charCodeAt(0) <= 255)) {
    try {
      originalname = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(originalname, 'latin1'),
      );
    } catch {
      /* Preserve non-UTF-8 names. */
    }
  }
  const ext = path.extname(originalname).toLowerCase(),
    b = f.buffer,
    mime = types[ext];
  const textFile = ext === '.txt' || ext === '.md';
  const suppliedMime = f.mimetype.split(';')[0].trim().toLowerCase();
  const compatibleTextMime =
    textFile &&
    (suppliedMime === 'text/plain' ||
      suppliedMime === 'application/octet-stream' ||
      (ext === '.md' &&
        ['text/markdown', 'text/x-markdown'].includes(suppliedMime)));
  assert(
    mime &&
      (mime === suppliedMime ||
        compatibleTextMime ||
        (ext === '.zip' && suppliedMime === 'application/x-zip-compressed')),
    '不支持的文件类型或 MIME',
  );
  if (ext === '.png')
    assert(
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'PNG 签名无效',
    );
  else if (['.jpg', '.jpeg'].includes(ext))
    assert(b[0] === 255 && b[1] === 216 && b[2] === 255, 'JPEG 签名无效');
  else if (ext === '.pdf')
    assert(b.subarray(0, 5).toString() === '%PDF-', 'PDF 签名无效');
  else if (textFile) {
    assert(!b.includes(0), 'TXT/Markdown 不能包含二进制空字节');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch {
      assert(false, 'TXT/Markdown 必须使用 UTF-8 编码');
    }
  } else {
    assert(
      b[0] === 80 && b[1] === 75 && b[2] === 3 && b[3] === 4,
      'ZIP/Office 文件签名无效',
    );
    const entries = zipEntries(b);
    if (ext !== '.zip')
      assert(
        entries.includes('[Content_Types].xml') &&
          entries.some((n) => n.startsWith(ext === '.docx' ? 'word/' : 'xl/')),
        'Office 文件内容与扩展名不符',
      );
  }
  return {
    mime,
    name:
      path
        .basename(originalname.replace(/\\/g, '/'))
        .replace(/[\r\n\x00-\x1f]/g, '')
        .slice(0, 240) || 'attachment',
  };
}
