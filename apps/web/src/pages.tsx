import React, {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Alert, Button, Spin } from 'antd';

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Alert
        type="error"
        showIcon
        message="页面加载失败"
        description="请检查网络后重新加载页面。"
        action={
          <Button onClick={() => window.location.reload()}>重新加载</Button>
        }
      />
    ) : (
      this.props.children
    );
  }
}
function page(load: () => Promise<{ default: ComponentType<any> }>) {
  const View = lazy(load);
  return function Page(props: any) {
    return (
      <PageBoundary>
        <Suspense
          fallback={
            <div role="status" aria-live="polite">
              <Spin /> 正在加载页面…
            </div>
          }
        >
          <View {...props} />
        </Suspense>
      </PageBoundary>
    );
  };
}
export const Workspace = page(() => import('./Workspace.js'));
export const Documents = page(() => import('./Documents.js'));
export const Management = page(() => import('./Management.js'));
export const Portal = page(() =>
  import('./components/Portal.js').then((m) => ({ default: m.Portal })),
);

export const Templates = page(() => import('./Templates.js'));
export const ProjectForks = page(() => import('./ProjectForks.js'));

export const Competitions = page(() => import('./Competitions.js'));
export const StudentWriting = page(() => import('./StudentWriting.js'));

export const FirstStepAgent = page(() => import('./FirstStepAgent.js'));

export const Settings = page(() => import('./Settings.js'));

export const ProofLoop = page(() => import('./ProofLoop.js'));

export const ProjectSettings = page(() => import('./ProjectSettings.js'));

export const AIQuality = page(() => import('./AIQuality.js'));
export const FileImport = page(() => import('./components/FileImport.js'));
