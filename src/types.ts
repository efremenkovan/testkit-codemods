import { MigrationKind } from "./constants";

export type Options = {
  isDryRun: boolean;
  isSilent: boolean;
  skipFormatting: boolean;
  only: MigrationKind[];
};
