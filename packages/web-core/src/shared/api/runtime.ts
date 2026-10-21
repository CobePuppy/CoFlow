import { QueryClient, useQuery } from '@tanstack/react-query';
import { ApiError, readApiResponse } from './api-response.js';
let csrf = '';
let sessionGeneration = 0;
let sessionRequests = new AbortController();
export function expireSession() {
  sessionGeneration++;
  sessionRequests.abort();
  sessionRequests = new AbortController();
  csrf = '';
  void client.cancelQueries();
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  client.setQueryData(['me'], null);
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(
  url: string,
  method = 'GET',
  body?: any,
  key?: string,
  signal?: AbortSignal,
) {
  const generation = sessionGeneration;
  const r = await fetch('/api/v1' + url, {
    signal: signal
      ? AbortSignal.any([signal, sessionRequests.signal])
      : sessionRequests.signal,
    method,
    credentials: 'same-origin',
    headers: {
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      'X-CSRF-Token': csrf,
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  if (generation !== sessionGeneration)
    throw new DOMException('登录状态已变化', 'AbortError');
  if (r.status === 401 && (url === '/auth/me' || !url.startsWith('/auth/'))) {
    expireSession();
    throw new ApiError('登录已过期，请重新登录', 401);
  }
  const data = await readApiResponse(r);
  if (generation !== sessionGeneration)
    throw new DOMException('登录状态已变化', 'AbortError');
  return data;
}
export const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
export function useData(
  key: any[],
  url: string,
  enabled = true,
  interval?: number,
) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api(url, 'GET', undefined, undefined, signal),
    enabled,
    refetchInterval: interval,
  });
}
