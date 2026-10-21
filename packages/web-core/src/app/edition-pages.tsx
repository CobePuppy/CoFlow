import { lazy, Suspense, type ComponentType } from 'react';
import { Alert, Spin } from 'antd';
type Loader = () => Promise<{ default: ComponentType<any> }>;
const pages = new Map<string, ComponentType<any>>();
export function registerEditionPage(name: string, loader: Loader) {
  pages.set(name, lazy(loader));
}
export function editionPage(name: string) {
  return function EditionPage(props: any) {
    const View = pages.get(name);
    return View ? (
      <Suspense fallback={<Spin />}>
        <View {...props} />
      </Suspense>
    ) : (
      <Alert type="info" message="当前版本没有此页面，请从设置切换产品版本。" />
    );
  };
}
