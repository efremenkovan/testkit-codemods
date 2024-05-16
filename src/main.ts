// #! /usr/bin/env node
import { argv } from "node:process";
import fs from "node:fs/promises";
import pathModule from "node:path";
import { Project } from "ts-morph";
import { getListOfRequiredMigrations } from "./migration_guards";
import { MigrationKind } from "./constants";
import {
  migrateFromForkToTestKit,
  migrateFromCreateWatchToWatcher,
} from "./migrations";
import { Options } from "./types";
import { formatProjectBasedOnFile } from "./formatters";

async function main() {
  const entryPath = argv
    .find((arg) => arg.startsWith("--path="))
    ?.replace("--path=", "");

  const isDryRun = (() => {
    const argValue = argv
      .find((arg) => arg.startsWith("--dry"))
      ?.replace(/--dry=?/, "");

    if (argValue === "" || argValue === "true") {
      return true;
    }

    return false;
  })();

  const isSilent = (() => {
    const argValue = argv
      .find((arg) => arg.startsWith("--silent"))
      ?.replace(/--silent=?/, "");

    if (argValue === "false") {
      return false;
    }

    return true;
  })();

  const only = (() => {
    const argValue = argv
      .find((arg) => arg.startsWith("--only"))
      ?.replace(/--only=?/, "");

    return (
      argValue
        ?.split(",")
        .filter((kind: string): kind is MigrationKind =>
          Object.values<string>(MigrationKind).includes(kind),
        ) ?? []
    );
  })();

  console.log({ only });

  const skipFormatting = argv.some((arg) =>
    arg.startsWith("--skip-formatting"),
  );

  if (!entryPath) {
    console.error("No entry path provided");
    return process.exit(1);
  }

  const isFile = await fs.lstat(entryPath).then((entry) => entry.isFile());

  const options = {
    isDryRun,
    isSilent,
    skipFormatting,
    only,
  };

  if (isFile) {
    await processFileByPath(entryPath, options);
    if (!skipFormatting) {
      console.log("Running formatters on project");
      await formatProjectBasedOnFile(entryPath);
    }
    return;
  }

  await processDirectoryByPath(entryPath, options);
  if (!skipFormatting) {
    console.log("Running formatters on project");
    await formatProjectBasedOnFile(entryPath);
  }
}

async function getAllTestFilesInDirectory(path: string): Promise<string[]> {
  const isDirectory = await fs.lstat(path).then((entry) => entry.isDirectory());

  if (!isDirectory) {
    throw new Error(
      "getAllTestFilesInDirectory: Provided path is not a directory",
    );
  }

  const testFiles: string[] = [];
  const directoriesToProcess: string[] = [path];

  for (const directoryPath of directoriesToProcess) {
    const children = await fs.readdir(directoryPath);

    for (const childPath of children) {
      const fullChildPath = pathModule.join(directoryPath, childPath);
      const isDirectory = await fs
        .lstat(fullChildPath)
        .then((entry) => entry.isDirectory());

      if (isDirectory) {
        directoriesToProcess.push(fullChildPath);
        continue;
      }

      if (isTestFile(childPath)) {
        testFiles.push(fullChildPath);
      }
    }
  }

  return testFiles;
}

function isTestFile(path: string): boolean {
  return /^.*\.(vitest|test|spec)\.[tj]sx?$/.test(path);
}

async function processFileByPath(path: string, options: Options) {
  if (!isTestFile(path)) {
    throw new Error("Attempt to process non-test file");
  }

  const fileContent = await fs.readFile(path);
  const project = new Project();
  const sourceFile = project.createSourceFile(path, fileContent.toString(), {
    overwrite: true,
  });

  const allMigrations = getListOfRequiredMigrations(sourceFile);
  const migrationsToRun = options.only.length
    ? allMigrations.filter((migration) => options.only.includes(migration))
    : allMigrations;

  let didPatchAnything = false;
  migrationsToRun.forEach((migration) => {
    switch (migration) {
      case MigrationKind.Fork:
        didPatchAnything =
          migrateFromForkToTestKit(sourceFile) || didPatchAnything;
        break;
      case MigrationKind.CreateWatch:
        didPatchAnything =
          migrateFromCreateWatchToWatcher(sourceFile) || didPatchAnything;
        break;
    }
  });

  if (!options.isSilent) {
    console.log(sourceFile.getFullText());
  }

  if (!options.isDryRun) {
    await sourceFile.save();
  }

  return didPatchAnything;
}

async function processDirectoryByPath(path: string, options: Options) {
  const testFiles = await getAllTestFilesInDirectory(path);

  let count = 0;
  for (const testFilePath of testFiles) {
    const isModified = await processFileByPath(testFilePath, options);
    if (isModified) {
      count++;
    }
  }

  console.log(`Patched ${count} files`);
}

main();
