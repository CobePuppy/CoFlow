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
export function page(load: () => Promise<{ default: ComponentType<any> }>) {
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
