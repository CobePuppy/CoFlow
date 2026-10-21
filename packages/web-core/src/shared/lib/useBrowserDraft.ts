import { useEffect, useRef, useState } from 'react';
import { createClientId } from './client-id.js';
import {
  draftKey,
  draftValues,
  readDraft,
  writeDraft,
  type BrowserDraft,
} from './browser-draft.js';
export function useBrowserDraft(
  parts: string[],
  enabled: boolean,
  base: number | null,
  fields: readonly string[],
) {
  const key = draftKey(parts);
  const [candidate, setCandidate] = useState<BrowserDraft | null>(null);
  const [notice, setNotice] = useState('');
  const pending = useRef<BrowserDraft | null>(null),
    own = useRef<string | null>(null);
  const baseRef = useRef(base);
  useEffect(() => {
    if (!enabled) return;
    baseRef.current = base;
    own.current = null;
    const load = () => {
      try {
        const d = readDraft(localStorage, key);
        pending.current = d;
        setCandidate(d);
        setNotice('');
      } catch {
        setNotice('浏览器无法读取工作副本，请保留当前输入');
      }
    };
    load();
    const changed = (e: StorageEvent) => {
      if (e.key === key) load();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key, enabled]);
  function save(values: Record<string, unknown>, explicitBase?: number | null) {
    if (!enabled || pending.current) return;
    if (explicitBase !== undefined) baseRef.current = explicitBase;
    try {
      const record = {
        token: createClientId(),
        at: Date.now(),
        base: baseRef.current,
        values: draftValues(values, fields),
      };
      if (!writeDraft(localStorage, key, own.current, record)) {
        pending.current = readDraft(localStorage, key);
        setCandidate(pending.current);
        setNotice('另一个页面更新了工作副本，请先核对');
        return;
      }
      own.current = record.token;
      setNotice('工作副本已保存在当前浏览器');
    } catch {
      setNotice('工作副本保存失败，请复制保留输入后再离开');
    }
  }
  function clear() {
    try {
      if (!writeDraft(localStorage, key, own.current, null)) {
        setNotice('另一页面的工作副本已保留');
        return;
      }
      own.current = null;
      setNotice('');
    } catch {
      setNotice('无法清除浏览器工作副本');
    }
  }
  function discard() {
    try {
      if (
        !writeDraft(localStorage, key, pending.current?.token ?? null, null)
      ) {
        setNotice('工作副本已变化，请重新打开后核对');
        return;
      }
      pending.current = null;
      own.current = null;
      setCandidate(null);
      setNotice('旧工作副本已舍弃');
    } catch {
      setNotice('无法清除浏览器工作副本');
    }
  }
  function restore() {
    const d = pending.current;
    if (!d || d.base !== base) return null;
    own.current = d.token;
    pending.current = null;
    setCandidate(null);
    baseRef.current = base;
    setNotice('已恢复工作副本，请核对后保存或提交');
    return draftValues(d.values, fields);
  }
  return {
    candidate,
    notice,
    save,
    clear,
    discard,
    restore,
    conflict: !!candidate && candidate.base !== base,
  };
}
