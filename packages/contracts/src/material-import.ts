export const materialKinds = [
  'solution',
  'development',
  'testing',
  'testEnvironment',
  'simpleDelivery',
] as const;
export type MaterialKind = (typeof materialKinds)[number];
export type ImportKind = 'project' | 'requirement' | MaterialKind;

type Field = {
  label: string;
  aliases: string[];
  max: number;
  type?: 'number' | 'date';
};
const field = (
  label: string,
  aliases: string[],
  max = 10000,
  type?: Field['type'],
): Field => ({ label, aliases: [label, ...aliases], max, type });
export const materialImports: Record<
  MaterialKind,
  { title: string; primary: string; fields: Record<string, Field> }
> = {
  solution: {
    title: '技术方案',
    primary: 'body',
    fields: {
      body: field(
        '方案正文',
        ['技术方案', '开发方案', '实现方案', '方案说明'],
        60000,
      ),
      scope: field('影响范围', ['实施范围', '方案范围']),
      effort: field(
        '预计工作量（人日）',
        ['预计工作量', '工作量', '工作量估算'],
        50,
        'number',
      ),
      risk: field('风险说明', ['风险', '技术风险', '风险分析']),
      start: field('预计开始日期', ['开始日期', '计划开始'], 10, 'date'),
      end: field('预计结束日期', ['结束日期', '计划结束'], 10, 'date'),
    },
  },
  development: {
    title: '开发交付与自测',
    primary: 'summary',
    fields: {
      summary: field('开发说明', [
        '实现说明',
        '实现摘要',
        '交付说明',
        '开发总结',
      ]),
      selfTest: field('自测结果', ['自测', '自测记录', '自测说明']),
      releaseVersion: field('交付版本', ['发布版本', '版本号'], 200),
      environment: field('环境地址或说明', [
        '环境',
        '测试环境',
        '环境地址',
        '部署环境',
      ]),
      knownIssues: field('已知问题', ['遗留问题', '待解决问题']),
    },
  },
  testing: {
    title: '测试执行记录',
    primary: 'record',
    fields: {
      record: field(
        '测试执行记录',
        ['测试记录', '测试报告', '测试过程', '执行记录'],
        60000,
      ),
      deployment: field('部署验证说明', [
        '部署验证',
        '部署信息',
        '部署验证记录',
      ]),
      reason: field('失败原因', ['不通过原因', '失败说明']),
    },
  },
  testEnvironment: {
    title: '测试环境',
    primary: 'environment',
    fields: {
      environment: field('测试环境', [
        '环境',
        '环境地址',
        '环境地址或说明',
        '部署环境',
      ]),
    },
  },
  simpleDelivery: {
    title: '交付说明',
    primary: 'summary',
    fields: {
      summary: field('完成说明', ['交付说明', '实现说明', '开发说明']),
    },
  },
};

export function materialKindForAction(
  action: string,
): MaterialKind | undefined {
  return (
    {
      SUBMIT_SOLUTION: 'solution',
      COMPLETE_DEVELOPMENT: 'development',
      START_TEST: 'testEnvironment',
      PASS_TEST: 'testing',
      FAIL_TEST: 'testing',
      SUBMIT_ACCEPTANCE: 'simpleDelivery',
    } as Record<string, MaterialKind>
  )[action];
}

// Only extract explicit headings/labels. Missing effort, schedules and results stay empty.
export function materialFieldsFromText(
  kind: MaterialKind,
  text: string,
): Record<string, string | number> {
  const config = materialImports[kind];
  const normalize = (s: string) =>
    s
      .replace(/\*\*/g, '')
      .replace(/^[\d一二三四五六七八九十]+[.、)）]\s*/, '')
      .trim();
  const aliases = new Map(
    Object.entries(config.fields).flatMap(([key, f]) =>
      f.aliases.map((alias) => [normalize(alias), key] as const),
    ),
  );
  const sections: Record<string, string[]> = {};
  let current = '',
    fence = '';
  for (const line of text.split(/\r?\n/)) {
    const code = line.trim().match(/^(`{3,}|~{3,})/);
    if (code) {
      if (!fence) fence = code[1][0];
      else if (code[1][0] === fence) fence = '';
      if (current) sections[current].push(line);
      continue;
    }
    const heading = !fence && line.match(/^\s*#{1,6}\s+(.+?)\s*#*$/);
    const inline =
      !fence && line.match(/^\s*(?:[-*]\s+)?(.{1,35}?)[：:]\s*(.*)$/);
    const key = heading
      ? aliases.get(normalize(heading[1]))
      : inline
        ? aliases.get(normalize(inline[1]))
        : undefined;
    if (key) {
      current = key;
      sections[key] ||= [];
      if (!heading && inline && inline[2]) sections[key].push(inline[2]);
    } else if (current) sections[current].push(line);
  }
  const result: Record<string, string | number> = {};
  for (const [key, f] of Object.entries(config.fields)) {
    const value = sections[key]?.join('\n').trim();
    if (!value) continue;
    if (f.type === 'number') {
      const match = value.match(/^(\d+(?:\.\d+)?)\s*(?:人日|人天|天)?$/);
      if (match && +match[1] > 0 && +match[1] <= 36500) result[key] = +match[1];
    } else if (f.type === 'date') {
      const date = value
        .replace(/年|\//g, '-')
        .replace(/月/g, '-')
        .replace(/日$/, '')
        .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (date) {
        const iso = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
        const parsed = new Date(iso);
        if (
          Number.isFinite(parsed.getTime()) &&
          parsed.toISOString().startsWith(iso)
        )
          result[key] = iso;
      }
    } else result[key] = value;
  }
  if (!result[config.primary]) result[config.primary] = text;
  return result;
}
