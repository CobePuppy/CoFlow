import React from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from '../../packages/web-core/src/shared/ui/Markdown.js';
import '../../packages/web-core/src/shared/styles/global.css';

const content = `# 需求资料

| 任务 | 优先级 | 验收证据 |
| --- | --- | --- |
| 开发 | P0 | ${'长文本验收证据'.repeat(30)} |

- [x] 已完成
- [ ] 待处理

~~废弃内容~~

\`\`\`mermaid
flowchart LR
  A[开发] --> B[测试] --> C[交付]
\`\`\`

\`\`\`mermaid
flowchart LR
  D[方案] --> E[评估]
\`\`\`

\`\`\`mermaid
not a valid diagram
\`\`\`

\`\`\`js
const text = '<script>alert(1)</script>';
\`\`\`

[危险链接](javascript:alert(1))

<img src=x onerror="window.markdownUnsafe=true">
`;
createRoot(document.getElementById('root')!).render(
  <Markdown>{content}</Markdown>,
);
