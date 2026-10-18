export const studentDraftKinds = {
  proposal: '项目计划书',
  report: '结题报告',
  defense: '答辩提纲',
  statement: '参赛材料说明',
} as const;
export function studentDraft(
  kind: keyof typeof studentDraftKinds,
  context: string,
) {
  const sections = {
    proposal: [
      '项目背景与问题',
      '目标与需求范围',
      '团队分工',
      '实施计划与里程碑',
      '资源与风险',
      '验收标准与预期成果',
    ],
    report: [
      '项目概述',
      '完成工作与实际结果',
      '需求完成情况',
      '验证方法与证据',
      '问题与不足',
      '团队贡献',
      '后续工作',
      '资料来源',
    ],
    defense: [
      '问题与目标',
      '方案与关键决策',
      '实现与成果展示',
      '验证证据',
      '团队分工',
      '局限与改进',
      '预计问答',
    ],
    statement: [
      '材料用途与提交要求',
      '项目与团队信息',
      '成员分工',
      '材料清单',
      '引用与素材来源',
      '待核对事项',
    ],
  }[kind];
  return (
    `# ${context} · ${studentDraftKinds[kind]}\n\n> 结构草稿：请依据实际项目和竞赛通知填写，核对格式与提交要求。\n\n` +
    sections
      .map((title, i) => `## ${i + 1}. ${title}\n\n[待填写真实内容及证据]\n`)
      .join('\n')
  );
}
