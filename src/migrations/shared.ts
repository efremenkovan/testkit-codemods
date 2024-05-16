import {
  ImportDeclaration,
  LeftHandSideExpression,
  SourceFile,
} from "ts-morph";

export function getIfExpressionIsTestCase(
  expression: LeftHandSideExpression,
): boolean {
  return (
    [
      "it",
      "test",
      "it.skip",
      "test.skip",
      "test.concurrent",
      "it.concurrent",
    ].includes(expression.getText()) ||
    ["it.each", "test.each", "it.concurrent.each", "test.concurrent.each"].some(
      (match) =>
        expression.getText().startsWith(match) &&
        expression.getText() !== match,
    )
  );
}

export function getEffectorImportDeclaration(
  sourceFile: SourceFile,
): ImportDeclaration | null {
  return (
    sourceFile.getImportDeclarations().find((importDeclaration) =>
      importDeclaration
        .getModuleSpecifier()
        .print()
        .match(/^["']effector['"]$/),
    ) ?? null
  );
}
