export function editionFromPath(pathname: string) {
  const student = /^\/student(?:\/|$)/.test(pathname);
  return {
    id: student ? 'student' : 'enterprise',
    label: student ? '学生版' : '企业版',
    base: student
      ? '/student'
      : /^\/enterprise(?:\/|$)/.test(pathname)
        ? '/enterprise'
        : '',
    primary: student ? '#087f79' : '#1469d8',
  } as const;
}
export const edition = editionFromPath(
  typeof window === 'undefined' ? '/' : window.location.pathname,
);
export const editionHome = (edition.base || '') + '/';
export function withEditionPath(route: string) {
  return edition.base + (route.startsWith('/') ? route : '/' + route);
}
