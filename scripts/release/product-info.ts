import fs from 'node:fs';
export function publicHistory(markdown: string) {
  return markdown
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const [heading, ...lines] = section.split(/\r?\n/);
      const match = heading.match(/^(\d+\.\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})/);
      if (!match) return [];
      const categoryLine =
        lines.find((line) => line.startsWith('- 类别：')) || '';
      const categories = [
        'frontend',
        'backend',
        'feature',
        'maintenance',
      ].filter((c) => categoryLine.includes(c));
      const changes = lines
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2))
        .filter(
          (line) =>
            !/^(类别|验证|状态|回归修复|部署|兼容与迁移|迁移)[：:]/.test(
              line,
            ) &&
            !/10\.16\.|127\.0\.0\.1|运行标识|密钥|上传校验|服务器监控/.test(
              line,
            ),
        );
      return [{ version: match[1], date: match[2], categories, changes }];
    });
}
export function productInfoPlugin() {
  const versionFile = new URL('../../version.json', import.meta.url);
  const historyFile = new URL('../../CHANGELOG.md', import.meta.url);
  return {
    name: 'coflow-public-product-info',
    resolveId(id: string) {
      if (id === 'virtual:coflow-product-info') return '\0coflow-product-info';
    },
    load(id: string) {
      if (id !== '\0coflow-product-info') return;
      const version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      return (
        'export default ' +
        JSON.stringify({
          product: version.product,
          web: version.web,
          api: version.api,
          date: version.date,
          history: publicHistory(fs.readFileSync(historyFile, 'utf8')),
        }) +
        ';'
      );
    },
  };
}
