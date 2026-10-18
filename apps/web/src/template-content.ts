import type { TemplateContent } from '../../../packages/contracts/index.js';
export function templateContent(values: Record<string, any>): TemplateContent {
  return {
    title: String(values.title || ''),
    background: String(values.background || ''),
    goal: String(values.goal || ''),
    description: String(values.description || ''),
    criteria: (Array.isArray(values.criteria)
      ? values.criteria
      : String(values.criteria || '').split('\n')
    )
      .map((line: unknown) => String(line).trim())
      .filter(Boolean),
    priority: ['P0', 'P1', 'P2', 'P3'].includes(values.priority)
      ? values.priority
      : 'P2',
  };
}
export function templateFormValues(content: TemplateContent) {
  return { ...templateContent(content), criteria: content.criteria.join('\n') };
}
