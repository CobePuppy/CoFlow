import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const roots = [
  'apps/enterprise-web/src',
  'apps/student-web/src',
  'packages/web-core/src',
  'packages/ui/src',
  'packages/contracts/src',
  'apps/api/src',
];
function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((x) =>
      x.isDirectory() ? walk(path.join(dir, x.name)) : [path.join(dir, x.name)],
    );
}
test('架构边界：共享前端不依赖学生应用或后端，共享UI/契约不依赖应用', () => {
  const graph = new Map<string, string[]>();
  for (const file of roots.flatMap(walk).filter((x) => /\.tsx?$/.test(x))) {
    const normalized = file.replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const deps: string[] = [];
    function visit(n: ts.Node) {
      if (
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier)
      )
        deps.push(n.moduleSpecifier.text);
      ts.forEachChild(n, visit);
    }
    visit(ast);
    for (const dep of deps) {
      assert(
        !dep.includes('packages/contracts/'),
        `${file}: 使用契约包导出，避免穿透目录`,
      );
      if (normalized.startsWith('packages/')) {
        assert(!dep.includes('/apps/'), `${file} -> ${dep}`);
        if (!normalized.startsWith('packages/web-core/'))
          assert(!dep.includes('web-core'), `${file} -> ${dep}`);
      }
      if (!normalized.startsWith('apps/api/'))
        assert(!dep.includes('apps/api/'), `${file} -> ${dep}`);
    }
    graph.set(
      path.resolve(file),
      deps
        .filter((x) => x.startsWith('.'))
        .map((x) => path.resolve(path.dirname(file), x))
        .map((x) =>
          [x.replace(/\.js$/, '.ts'), x.replace(/\.js$/, '.tsx'), x].find((p) =>
            fs.existsSync(p),
          ),
        )
        .filter(Boolean) as string[],
    );
  }
  // Shared access helpers must not import a business service facade back into themselves.
  assert(
    !fs
      .readFileSync('apps/api/src/shared/access.ts', 'utf8')
      .includes("from './context.js'"),
  );
  const visiting = new Set<string>(),
    done = new Set<string>();
  function dfs(file: string) {
    if (done.has(file)) return;
    assert(!visiting.has(file), '循环模块依赖：' + file);
    visiting.add(file);
    for (const next of graph.get(file) || []) if (graph.has(next)) dfs(next);
    visiting.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) dfs(file);
});
