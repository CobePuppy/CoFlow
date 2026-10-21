import { useLayoutEffect, useId } from 'react';
const dirty = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
export function subscribeUnsavedChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function hasUnsavedChanges() {
  return dirty.size > 0;
}
export function discardUnsavedChanges() {
  dirty.clear();
  changed();
}
export function useUnsavedChanges(value: boolean) {
  const id = useId();
  useLayoutEffect(() => {
    if (value) dirty.add(id);
    else dirty.delete(id);
    changed();
    return () => {
      dirty.delete(id);
      changed();
    };
  }, [id, value]);
}
if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
