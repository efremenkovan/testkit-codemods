import {
  Node,
  SourceFile,
  SyntaxKind,
  VariableDeclaration,
  VariableDeclarationKind,
} from "ts-morph";
import {
  getEffectorImportDeclaration,
  getIfExpressionIsTestCase,
} from "./shared";

export function migrateFromForkToTestKit(sourceFile: SourceFile) {
  const testKitDeclaration = sourceFile.getVariableDeclaration("testKit");

  let didPatch = false;
  if (!testKitDeclaration) {
    createTestKitDeclaration(sourceFile);
    removeNativeForkImport(sourceFile);
    didPatch = true;
  }

  const didPatchTestKitUsage = replaceForkWithTestKit(sourceFile);
  return didPatchTestKitUsage || didPatch;
}

export function createTestKitDeclaration(sourceFile: SourceFile) {
  const importDeclarations = sourceFile.getImportDeclarations();

  const isAbsoluteImportAlreadyExists = importDeclarations.some(
    (importDeclaration) =>
      importDeclaration.getModuleSpecifierValue().startsWith("&"),
  );
  const isRelativeImportAlreadyExists = importDeclarations.some(
    (importDeclaration) =>
      importDeclaration.getModuleSpecifierValue().startsWith("."),
  );

  const isOuterImportAlreadyExists =
    importDeclarations.length -
      importDeclarations.filter((importDeclaration) =>
        importDeclaration.getModuleSpecifierValue().startsWith("&"),
      ).length -
      importDeclarations.filter((importDeclaration) =>
        importDeclaration.getModuleSpecifierValue().startsWith("."),
      ).length >
    0;

  const importDeclarationPosition = (() => {
    const firstInnerAbsoluteImport = importDeclarations.findIndex(
      (importDeclaration) =>
        importDeclaration.getModuleSpecifierValue().startsWith("&"),
    );

    if (firstInnerAbsoluteImport !== -1) {
      return firstInnerAbsoluteImport;
    }

    const firstRelativeImport = importDeclarations.findIndex(
      (importDeclaration) =>
        importDeclaration.getModuleSpecifierValue().startsWith("."),
    );

    if (firstRelativeImport !== -1) {
      return firstRelativeImport;
    }

    return importDeclarations.length;
  })();

  const shouldImportHaveLeadingTrailingLine = isOuterImportAlreadyExists;
  const shouldImportHaveTrailingTrailingLine =
    !isAbsoluteImportAlreadyExists && isRelativeImportAlreadyExists;

  sourceFile.insertImportDeclaration(importDeclarationPosition, {
    moduleSpecifier: "&test_utils/test_kit",
    namedImports: ["createTestKit"],
    leadingTrivia: shouldImportHaveLeadingTrailingLine ? "\n" : undefined,
    trailingTrivia: shouldImportHaveTrailingTrailingLine ? "\n\n" : undefined,
  });

  sourceFile.insertVariableStatement(
    sourceFile.getImportDeclarations().length,
    {
      declarationKind: VariableDeclarationKind.Const,
      declarations: [
        {
          name: "testKit",
          initializer: getTestKitInitializerTemplate(),
        },
      ],
      trailingTrivia: "\n\n",
    },
  );
}

export function replaceForkWithTestKit(sourceFile: SourceFile) {
  const nodesToLookThrough = sourceFile.getChildren();
  let didPatchAnything = false;

  for (const node of nodesToLookThrough) {
    if (node.getChildren().length > 0) {
      nodesToLookThrough.push(...node.getChildren());
    }

    // Only look for `it` and `test` calls, 'cause we can't meet scope declaration in other places
    if (!Node.isCallExpression(node)) continue;

    const expression = node.getExpression();

    if (!getIfExpressionIsTestCase(expression)) continue;

    const didPatch = node
      .getChildrenOfKind(SyntaxKind.SyntaxList)[0]
      .getChildren()
      .flatMap((node) => node.getChildrenOfKind(SyntaxKind.Block))
      .filter(Boolean)
      .map((node) => {
        const scopeDeclaration = node.getVariableDeclaration("scope");

        if (!scopeDeclaration) {
          return false;
        }

        const isAlreadyUsingTestKit = Node.isObjectBindingPattern(
          scopeDeclaration.getFirstChild(),
        );
        if (isAlreadyUsingTestKit) {
          return false;
        }

        patchScopeDeclarationNode(scopeDeclaration);

        return true;
      });

    didPatchAnything = didPatchAnything || didPatch.some(Boolean);
  }

  return didPatchAnything;
}

export function removeNativeForkImport(sourceFile: SourceFile) {
  const effectorImportDeclaration = getEffectorImportDeclaration(sourceFile);

  if (!effectorImportDeclaration) return;

  const hasAnyImportsExceptFork = effectorImportDeclaration
    .getNamedImports()
    .some((child) => child.print() !== "fork");

  if (!hasAnyImportsExceptFork) {
    effectorImportDeclaration.remove();
    return;
  }

  effectorImportDeclaration
    .getNamedImports()
    .find((child) => child.print() === "fork")
    ?.remove();
}

export function patchScopeDeclarationNode(node: VariableDeclaration) {
  const forkArguments =
    node
      .getFirstChildByKind(SyntaxKind.CallExpression)
      ?.getFirstChildByKind(SyntaxKind.SyntaxList)
      ?.getText() ?? "";

  if (forkArguments) {
    node.replaceWithText(getForkTemplateWithMocks(forkArguments));
    return;
  }

  node.replaceWithText(getEmptyForkTemplate());
}

function getEmptyForkTemplate() {
  return `{ scope } = testKit.fork()`;
}

function getForkTemplateWithMocks(mocks: string) {
  return `{ scope } = testKit.fork({
\tmocks: () => [
\t\t${mocks.replace(/new Map(<.*>)?\((?<declarations>.+)\)/g, (_a, _b, _c, _d, _e, params) => params.declaratoins)}
\t]
})`;
}

function getTestKitInitializerTemplate() {
  return `await createTestKit({
\timportMetaUrl: import.meta.url
})`;
}
