import ts from "typescript";
import {
  ImportDeclaration,
  LeftHandSideExpression,
  SourceFile,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";
import {
  getEffectorImportDeclaration,
  getIfExpressionIsTestCase,
} from "./shared";

export function migrateFromCreateWatchToWatcher(
  sourceFile: SourceFile,
): boolean {
  const effectorImportDeclaration = getEffectorImportDeclaration(sourceFile);

  if (!effectorImportDeclaration) return false;

  const fileTestCases = getTestCases(sourceFile).filter(
    getIfCasCreateWatchExpression,
  );

  const results = fileTestCases.map((testCaseExpression) => {
    const isAdded = addWatcherToForkResultDestructuring(testCaseExpression);

    if (!isAdded) return false;

    const isReplaced = replaceCreateWatchWithWatcher(testCaseExpression);

    return isReplaced;
  });

  const replacedAll = results.filter(Boolean).length === fileTestCases.length;

  if (replacedAll) {
    removeCreateWatchImport(effectorImportDeclaration);
  }

  return results.filter(Boolean).length > 0;
}

function removeCreateWatchImport(
  effectorImportDeclaration: ImportDeclaration,
): boolean {
  const createWatchImport = effectorImportDeclaration
    .getNamedImports()
    .find((child) => child.print() === "createWatch");

  if (!createWatchImport) return false;

  createWatchImport.remove();

  if (effectorImportDeclaration.getNamedImports().length === 0) {
    effectorImportDeclaration.remove();
  }

  return true;
}

function getTestCases(sourceFile: SourceFile): LeftHandSideExpression[] {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((callExpression) =>
      getIfExpressionIsTestCase(callExpression.getExpression()),
    );
}

function addWatcherToForkResultDestructuring(
  testCase: LeftHandSideExpression,
): boolean {
  const testCaseBlockNode = testCase
    .getFirstChildByKind(SyntaxKind.ArrowFunction)
    ?.getFirstChildByKind(SyntaxKind.Block);

  const forkVariableStatement = testCaseBlockNode
    ?.getChildrenOfKind(SyntaxKind.VariableStatement)
    .find((variableStatement) => {
      return variableStatement
        .getFirstDescendantByKind(SyntaxKind.CallExpression)

        ?.getText()
        .match(/^testkit\.fork\(/i);
    });

  const forkBinding = forkVariableStatement?.getFirstDescendantByKind(
    SyntaxKind.ObjectBindingPattern,
  );

  const hasWatcherImport = forkBinding
    ?.getChildrenOfKind(SyntaxKind.BindingElement)
    .some((bindingElement) => bindingElement.getText() === "watcher");

  if (hasWatcherImport || !forkBinding) return false;

  forkBinding.transform((traversal) => {
    const node = traversal.currentNode;

    if (!ts.isObjectBindingPattern(node)) return node;

    return traversal.factory.updateObjectBindingPattern(node, [
      ...forkBinding
        .getChildrenOfKind(SyntaxKind.BindingElement)
        .map((child) => child.compilerNode),
      traversal.factory.createBindingElement(undefined, undefined, "watcher"),
    ]);
  });

  return true;
}

function getIfCasCreateWatchExpression(
  testCase: LeftHandSideExpression,
): boolean {
  const testCaseBlockNode = testCase
    .getFirstChildByKind(SyntaxKind.ArrowFunction)
    ?.getFirstChildByKind(SyntaxKind.Block);

  const createWatchExpressoin = testCaseBlockNode
    ?.getChildrenOfKind(SyntaxKind.ExpressionStatement)
    .find((expression) =>
      expression.getExpression()?.getText().startsWith("createWatch"),
    );

  return Boolean(createWatchExpressoin);
}

function replaceCreateWatchWithWatcher(testCase: LeftHandSideExpression) {
  const testCaseBlockNode = testCase
    .getFirstChildByKind(SyntaxKind.ArrowFunction)
    ?.getFirstChildByKind(SyntaxKind.Block);

  const createWatchExpressionList = testCaseBlockNode
    ?.getChildrenOfKind(SyntaxKind.ExpressionStatement)
    .filter((expression) =>
      expression.getExpression()?.getText().startsWith("createWatch"),
    );

  createWatchExpressionList?.forEach((createWatchExpression, index, list) => {
    const argumentObject = createWatchExpression
      ?.getExpression()
      ?.getFirstChildByKind(SyntaxKind.ObjectLiteralExpression);

    const unitName = argumentObject
      ?.getChildrenOfKind(SyntaxKind.PropertyAssignment)
      .find(
        (child) =>
          child.getFirstChildByKind(SyntaxKind.Identifier)?.getText() ===
          "unit",
      )
      ?.getLastChild()
      ?.getText();

    const watcherName = argumentObject
      ?.getChildrenOfKind(SyntaxKind.PropertyAssignment)
      .find(
        (child) =>
          child.getFirstChildByKind(SyntaxKind.Identifier)?.getText() === "fn",
      )
      ?.getLastChild()
      ?.getText();

    const forkVariableStatement = testCaseBlockNode
      ?.getChildrenOfKind(SyntaxKind.VariableStatement)
      .find((variableStatement) => {
        return variableStatement
          .getFirstDescendantByKind(SyntaxKind.CallExpression)

          ?.getText()
          .match(/^testkit\.fork\(/i);
      });

    if (!watcherName || !unitName || !forkVariableStatement) return false;

    createWatchExpression?.remove();
    const forkIndex = forkVariableStatement?.getChildIndex();
    const lastWatcherIndex = testCaseBlockNode
      ?.getChildrenOfKind(SyntaxKind.VariableStatement)
      ?.filter((statement) => {
        return statement
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          ?.some((expr) => expr.getText().startsWith("watcher"));
      })
      .at(-1)
      ?.getChildIndex();

    const hasLeadingTrivia = index === 0;
    const hasTrailingTrivia = index === list.length - 1;

    const indexToPlaceTo = (lastWatcherIndex ?? forkIndex) + 1;

    const newVariableStatement = testCaseBlockNode?.insertVariableStatement(
      indexToPlaceTo,
      {
        declarationKind: VariableDeclarationKind.Const,
        declarations: [
          {
            name: watcherName,
            initializer: `watcher(${unitName})`,
          },
        ],
      },
    );

    if (hasLeadingTrivia) {
      newVariableStatement?.prependWhitespace("\n");
    }

    if (hasTrailingTrivia) {
      newVariableStatement?.appendWhitespace("\n");
    }

    removeSeparateFunctionDeclaration(testCase, watcherName);
  });

  return (createWatchExpressionList?.length ?? 0) > 0;
}

function removeSeparateFunctionDeclaration(
  testCase: LeftHandSideExpression,
  watcherName: string,
): boolean {
  const testCaseBlockNode = testCase
    .getFirstChildByKind(SyntaxKind.ArrowFunction)
    ?.getFirstChildByKind(SyntaxKind.Block);

  const viFnDeclaration = testCaseBlockNode
    ?.getChildrenOfKind(SyntaxKind.VariableStatement)
    .find((child) => {
      const text = child.getText();
      return (
        text.startsWith(`const ${watcherName}`) &&
        text.match(/= vi(test)?\.fn\(\);$/)
      );
    });

  viFnDeclaration?.remove();

  return Boolean(viFnDeclaration);
}
