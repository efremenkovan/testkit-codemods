import { SourceFile } from "ts-morph";
import { MigrationKind } from "./constants";

export function getListOfRequiredMigrations(
  sourceFile: SourceFile,
): MigrationKind[] {
  const migrations = [];

  if (checkIfForkMigrationIsRequired(sourceFile)) {
    migrations.push(MigrationKind.Fork);
  }

  if (checkIfCreateWatchMigrationIsRequired(sourceFile)) {
    migrations.push(MigrationKind.CreateWatch);
  }

  return migrations.sort((a, b) => {
    return getMigrationPriority(a) - getMigrationPriority(b);
  });
}

function checkIfForkMigrationIsRequired(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some(
    (importDeclaration) =>
      importDeclaration
        .getModuleSpecifier()
        .print()
        .match(/^["']effector['"]$/) &&
      importDeclaration.getNamedImports().some((child) => {
        return child.print() === "fork";
      }),
  );
}

function checkIfCreateWatchMigrationIsRequired(
  sourceFile: SourceFile,
): boolean {
  return sourceFile.getImportDeclarations().some(
    (importDeclaration) =>
      importDeclaration
        .getModuleSpecifier()
        .print()
        .match(/^["']effector['"]$/) &&
      importDeclaration.getNamedImports().some((child) => {
        return child.print() === "createWatch";
      }),
  );
}

function getMigrationPriority(migration: MigrationKind): number {
  return {
    [MigrationKind.Fork]: 1,
    [MigrationKind.CreateWatch]: 2,
  }[migration];
}
