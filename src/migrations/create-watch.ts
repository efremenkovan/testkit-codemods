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

    if (isReplaced) {
      removeScopeVariableDeclaration(testCaseExpression);
    }

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
    const lastWatcher = testCaseBlockNode
      ?.getChildrenOfKind(SyntaxKind.VariableStatement)
      ?.filter((statement) => {
        return statement
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          ?.some((expr) => expr.getText().startsWith("watcher"));
      })
      .at(-1);

    const lastWatcherIndex = lastWatcher?.getChildIndex();

    const hasLeadingTrivia = index === 0;
    const hasTrailingTrivia = index === list.length - 1;

    const indexToPlaceTo = (lastWatcherIndex ?? forkIndex) + 1;

    removeSeparateFunctionDeclaration(testCase, watcherName);

    testCaseBlockNode?.insertVariableStatement(indexToPlaceTo, {
      declarationKind: VariableDeclarationKind.Const,
      declarations: [
        {
          name: watcherName,
          initializer: `watcher(${unitName})`,
        },
      ],
      leadingTrivia: hasLeadingTrivia ? "\n" : undefined,
      trailingTrivia: hasTrailingTrivia ? "\n" : undefined,
    });
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

function removeScopeVariableDeclaration(
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

  const scopeVariableDeclaration = forkBinding
    ?.getChildrenOfKind(SyntaxKind.BindingElement)
    .find((bindingElement) => bindingElement.getText() === "scope");

  if (!scopeVariableDeclaration || !forkBinding) return false;

  if (scopeVariableDeclaration.findReferencesAsNodes().length === 0) {
    forkBinding.replaceWithText((writer) => {
      const namesToLeave = forkBinding
        .getChildrenOfKind(SyntaxKind.BindingElement)
        .map((child) => child.getText())
        .filter((name) => name !== "scope");

      writer.write("{");
      writer.space();

      namesToLeave.forEach((name, index, array) => {
        writer.write(name);
        writer.conditionalWrite(index !== array.length - 1, ",");
        writer.space();
      });

      writer.write("}");
    });

    return true;
  }

  return false;
}
