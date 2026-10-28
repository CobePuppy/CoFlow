// 验收标准质量检查（CF-003）：前后端共享的启发式规则。
// 默认仅提醒不阻断；项目开启严格模式后用于拒绝提交，管理员可填理由强制放行。
export type CriteriaWarningCategory =
  | 'vague'
  | 'multi'
  | 'unobservable'
  | 'detail'
  | 'bug';

export type CriteriaWarning = {
  /** 第几条验收标准（从 1 开始）；0 表示整体问题。 */
  index: number;
  category: CriteriaWarningCategory;
  message: string;
};

const VAGUE_WORDS = [
  '尽量',
  '尽快',
  '适当',
  '酌情',
  '大致',
  '大概',
  '可能',
  '一定程度上',
  '若干',
  '必要时',
  '视情况',
  '进一步',
];
const OBSERVABLE_HINTS = [
  '能',
  '可以',
  '应当',
  '应该',
  '应',
  '需要',
  '必须',
  '显示',
  '返回',
  '输出',
  '提示',
  '生成',
  '保存',
  '提交',
  '支持',
  '校验',
  '拒绝',
  '允许',
  '小于',
  '大于',
  '等于',
  '不超过',
  '至少',
  '最多',
  '秒',
  '分钟',
  '小时',
  '%',
  '次',
];
const DETAIL_WORDS = [
  '数据库',
  '表结构',
  '字段名',
  '代码',
  '函数',
  '框架',
  '组件',
  '前端页面',
  '后端接口',
  '接口实现',
  'SQL',
  'SDK',
  '类库',
  '技术栈',
];
export const BUG_SECTIONS = ['复现步骤', '实际结果', '期望结果'] as const;

export function reviewCriteria(
  criteria: string[],
  opts: { type?: string; description?: string } = {},
): CriteriaWarning[] {
  const warnings: CriteriaWarning[] = [];
  (criteria || []).forEach((text, i) => {
    const c = (text || '').trim();
    if (!c) return;
    const index = i + 1;
    const vague = VAGUE_WORDS.find((w) => c.includes(w));
    if (vague)
      warnings.push({
        index,
        category: 'vague',
        message: `第${index}条包含模糊词“${vague}”，验收时难以客观判断`,
      });
    const multi =
      ['；', ';', '、'].some((sep) => c.includes(sep)) ||
      /并且|同时/.test(c);
    if (multi)
      warnings.push({
        index,
        category: 'multi',
        message: `第${index}条包含多个结果，建议拆分为一条一个可验证结果`,
      });
    const observable =
      OBSERVABLE_HINTS.some((w) => c.includes(w)) || /\d/.test(c);
    if (!observable)
      warnings.push({
        index,
        category: 'unobservable',
        message: `第${index}条缺少可观察结果，建议写明可看到、可验证的行为或数值`,
      });
    const detail = DETAIL_WORDS.find((w) => c.includes(w));
    if (detail)
      warnings.push({
        index,
        category: 'detail',
        message: `第${index}条包含实现细节（${detail}），验收标准应描述外部可观察行为`,
      });
  });
  if (opts.type === 'BUG') {
    const body = `${opts.description || ''}\n${(criteria || []).join('\n')}`;
    for (const section of BUG_SECTIONS)
      if (!body.includes(section))
        warnings.push({
          index: 0,
          category: 'bug',
          message: `BUG 类型需求缺少「${section}」，请补充后再提交`,
        });
  }
  return warnings;
}
