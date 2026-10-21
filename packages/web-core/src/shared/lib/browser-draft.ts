export type DraftValues = Record<string, string | number>;
export type BrowserDraft = {
  token: string;
  at: number;
  base: number | null;
  values: DraftValues;
};
export const draftPrefix = 'coflow:work-copy:v1:';
export function draftKey(parts: string[]) {
  return draftPrefix + JSON.stringify(parts);
}
export function readDraft(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): BrowserDraft | null {
  const raw = storage.getItem(key);
  if (!raw || raw.length > 1000000) return null;
  try {
    const d = JSON.parse(raw);
    if (
      !d ||
      typeof d.token !== 'string' ||
      typeof d.at !== 'number' ||
      Date.now() - d.at > 30 * 86400000 ||
      !(d.base === null || Number.isInteger(d.base)) ||
      !d.values ||
      Array.isArray(d.values) ||
      typeof d.values !== 'object' ||
      Object.values(d.values).some(
        (v) => typeof v !== 'string' && typeof v !== 'number',
      )
    )
      return null;
    return d;
  } catch {
    return null;
  }
}
export function writeDraft(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  previous: string | null,
  next: BrowserDraft | null,
) {
  if ((readDraft(storage, key)?.token ?? null) !== previous) return false;
  if (next) {
    const raw = JSON.stringify(next);
    if (raw.length > 1000000) throw new Error('工作副本超过浏览器保存上限');
    storage.setItem(key, raw);
  } else storage.removeItem(key);
  return true;
}
export function draftValues(
  values: Record<string, unknown>,
  fields: readonly string[],
): DraftValues {
  return Object.fromEntries(
    fields
      .filter(
        (k) => typeof values[k] === 'string' || typeof values[k] === 'number',
      )
      .map((k) => [k, values[k]]),
  ) as DraftValues;
}
