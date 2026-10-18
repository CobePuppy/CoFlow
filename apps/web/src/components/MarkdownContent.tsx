import React, { useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';

function Diagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [result, setResult] = useState({ source: '', svg: '', failed: false });
  useEffect(() => {
    let cancelled = false;
    const container = document.createElement('div');
    document.body.append(container);
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          htmlLabels: false,
          flowchart: { htmlLabels: false },
        });
        const { svg } = await mermaid.render(`diagram${id}`, source, container);
        const clean = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'a'],
        });
        if (!cancelled) setResult({ source, svg: clean, failed: false });
      } catch {
        if (!cancelled) setResult({ source, svg: '', failed: true });
      } finally {
        container.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, source]);
  if (result.source !== source) return <div role="status">正在绘制流程图…</div>;
  if (result.failed)
    return (
      <div>
        <p role="status">流程图语法无法解析，已保留原始代码。</p>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  return (
    <div className="markdown-diagram">
      <img
        alt="Mermaid 流程图"
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`}
      />
    </div>
  );
}

export default function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div
              className="markdown-table"
              tabIndex={0}
              role="region"
              aria-label="表格，可横向滚动"
            >
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => {
            const child = React.Children.toArray(children)[0];
            if (
              React.isValidElement<{
                className?: string;
                children?: React.ReactNode;
              }>(child) &&
              child.props.className === 'language-mermaid'
            )
              return (
                <Diagram
                  source={String(child.props.children).replace(/\n$/, '')}
                />
              );
            return <pre>{children}</pre>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
