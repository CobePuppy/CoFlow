import fs from 'node:fs';
import ts from 'typescript';
const prefixes = process.argv.slice(2);
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      ['node_modules', 'dist'].includes(e.name)
        ? []
        : e.isDirectory()
          ? walk(dir + '/' + e.name)
          : [dir + '/' + e.name],
    );
}
for (const file of [...walk('apps'), ...walk('packages')].filter(
  (f) => /\.tsx?$/.test(f) && prefixes.some((p) => f.startsWith(p)),
)) {
  let text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const used = new Set();
  function scan(n) {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n)) used.add(n.text);
    ts.forEachChild(n, scan);
  }
  scan(ast);
  const edits = [];
  const printer = ts.createPrinter();
  for (const n of ast.statements.filter(ts.isImportDeclaration)) {
    const c = n.importClause;
    if (!c) continue;
    const name = c.name && used.has(c.name.text) ? c.name : undefined;
    let bindings = c.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const keep = bindings.elements.filter((e) => used.has(e.name.text));
      bindings = keep.length
        ? ts.factory.updateNamedImports(bindings, keep)
        : undefined;
    } else if (bindings && !used.has(bindings.name.text)) bindings = undefined;
    const replacement =
      !name && !bindings
        ? ''
        : printer.printNode(
            ts.EmitHint.Unspecified,
            ts.factory.updateImportDeclaration(
              n,
              n.modifiers,
              ts.factory.updateImportClause(c, c.isTypeOnly, name, bindings),
              n.moduleSpecifier,
              n.attributes,
            ),
            ast,
          );
    edits.push([n.getStart(ast), n.end, replacement]);
  }
  for (const [start, end, value] of edits.reverse())
    text = text.slice(0, start) + value + text.slice(end);
  fs.writeFileSync(file, text);
}
