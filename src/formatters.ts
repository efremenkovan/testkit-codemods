import fs from "node:fs/promises";
import pathModule from "node:path";
import { spawn } from "node:child_process";

export async function formatProjectBasedOnFile(path: string) {
  const rootPath = await getFileProjectRoot(path);
  await applyPrettierFixes(rootPath, path);
}

async function getFileProjectRoot(filePath: string): Promise<string> {
  let rootPath = filePath;

  while (true) {
    const isDirectory = await fs
      .lstat(rootPath)
      .then((stat) => stat.isDirectory());

    if (!isDirectory) {
      rootPath = pathModule.dirname(rootPath);
      continue;
    }

    const containsPackageJson = await fs.readdir(rootPath).then((files) => {
      return files.includes("package.json");
    });

    if (containsPackageJson) {
      break;
    }

    rootPath = pathModule.dirname(rootPath);

    if (rootPath === "/") {
      throw new Error("No package.json found in the project root directory.");
    }
  }

  return rootPath;
}

async function applyPrettierFixes(rootPath: string, fixOnPath?: string) {
  let resolve: () => void;
  let reject: () => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const args = ["prettier", "--write", fixOnPath ?? "./"];

  const prettierProcess = spawn("npx", args, {
    cwd: rootPath,
  });

  prettierProcess.stdout.on("data", () => {});
  prettierProcess.stderr.on("data", () => {});
  prettierProcess.on("error", (error) => {
    console.error("Prettier process errored: ", error);
    reject();
  });

  prettierProcess.on("close", (code) => {
    console.log("Prettier process exited with code: ", code);
    resolve();
  });

  return promise;
}
