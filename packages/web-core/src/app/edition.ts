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
export interface AppDefinition {
  workspaceLabel: string;
  defaultWorkflow: 'SIMPLE' | 'STANDARD';
  introduction: string;
  flow: string;
  capabilities: { competitions: boolean; writing: boolean };
  categories: string[];
  apps: {
    id: string;
    name: string;
    category: string;
    description: string;
    icon: string;
    color: string;
  }[];
}
const fallback: AppDefinition = {
  workspaceLabel: '团队协作空间',
  defaultWorkflow: 'STANDARD',
  introduction: '让团队交付更清晰',
  flow: '需求 → 交付',
  capabilities: { competitions: false, writing: false },
  categories: ['协作', '管理'],
  apps: [],
};
export let edition: ReturnType<typeof editionFromPath> & AppDefinition = {
  ...fallback,
  ...editionFromPath(
    typeof window === 'undefined' ? '/' : window.location.pathname,
  ),
};
export let editionHome = (edition.base || '') + '/';
export function configureEdition(
  id: 'enterprise' | 'student',
  definition: AppDefinition,
) {
  const path =
    typeof window === 'undefined' ? '/' + id + '/' : window.location.pathname;
  edition = {
    ...definition,
    ...editionFromPath(id === 'student' ? '/student/' : path),
  };
  editionHome = (edition.base || '') + '/';
}
export function withEditionPath(route: string) {
  return edition.base + (route.startsWith('/') ? route : '/' + route);
}
