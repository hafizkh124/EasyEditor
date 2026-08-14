import ts from "typescript";
import { readSource, relativeSourcePath, sourceFiles } from "./sourceScan";

function isToastCall(expression: ts.LeftHandSideExpression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "toast";
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "toast"
  );
}

describe("hardcoded user-facing strings", () => {
  it("does not add Arabic-script literals to toast arguments", () => {
    const violations = new Map<string, number>();

    for (const file of sourceFiles()) {
      const source = readSource(file);
      // Parsing every TS/TSX module is needlessly expensive in the full suite.
      // The cheap prefilter keeps the AST check focused on possible matches.
      if (!source.includes("toast") || !/[\u0600-\u06ff]/u.test(source)) continue;
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      let count = 0;

      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          isToastCall(node.expression) &&
          node.arguments[0] &&
          /[\u0600-\u06ff]/u.test(node.arguments[0].getText(sourceFile))
        ) {
          count += 1;
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      if (count > 0) violations.set(relativeSourcePath(file), count);
    }

    const unexpected = [...violations].map(([file, count]) => `${file}: ${count}`);

    expect(unexpected).toEqual([]);
  }, 60_000);

  it("does not leave bare UI literals in Shamela, reader, or workspace components", () => {
    const violations: string[] = [];
    const checkedAttributes = new Set(["title", "aria-label", "placeholder"]);

    for (const file of sourceFiles()) {
      const relative = relativeSourcePath(file).replace(/\\/g, "/");
      if (
        !relative.startsWith("src/components/shamela/") &&
        !relative.startsWith("src/components/reader/") &&
        !relative.startsWith("src/components/workspace/")
      ) {
        continue;
      }

      const source = readSource(file);
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      function add(node: ts.Node, value: string) {
        if (!/[A-Za-z\u0600-\u06ff]/u.test(value)) return;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(`${relative}:${line}: ${value.trim()}`);
      }

      function visit(node: ts.Node) {
        if (ts.isJsxText(node)) {
          const value = node.getText(sourceFile).trim();
          if (value) add(node, value);
        }
        if (
          ts.isJsxAttribute(node) &&
          checkedAttributes.has(node.name.getText(sourceFile)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer)
        ) {
          add(node, node.initializer.text);
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  }, 60_000);
});
