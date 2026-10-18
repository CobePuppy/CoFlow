import React, { lazy, Suspense } from 'react';
import { Spin } from 'antd';
const LazyMarkdown = lazy(() => import('./MarkdownContent.js'));
export function Markdown({ children }: { children: string }) {
  return (
    <Suspense fallback={<Spin size="small" />}>
      <LazyMarkdown>{children}</LazyMarkdown>
    </Suspense>
  );
}
