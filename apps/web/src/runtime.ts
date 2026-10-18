import { QueryClient, useQuery } from '@tanstack/react-query';
import { readApiResponse } from './api-response.js';
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(
  url: string,
  method = 'GET',
  body?: any,
  key?: string,
) {
  const r = await fetch('/api/v1' + url, {
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
  if (r.status === 401 && !url.startsWith('/auth/'))
    client.setQueryData(['me'], null);
  return readApiResponse(r);
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
    queryFn: () => api(url),
    enabled,
    refetchInterval: interval,
  });
}
