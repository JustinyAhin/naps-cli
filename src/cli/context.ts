import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { StricliAutoCompleteContext } from "@stricli/auto-complete";

type CliContext = StricliAutoCompleteContext & {
  fetch: typeof fetch;
  runtime: {
    executablePath: string;
    platform: NodeJS.Platform;
    architecture: string;
  };
};

const createContext = (): CliContext => ({
  process,
  fs,
  fetch,
  os,
  path,
  runtime: {
    executablePath: process.execPath,
    platform: process.platform,
    architecture: process.arch,
  },
});

const writeJson = ({ context, value }: { context: CliContext; value: unknown }) => {
  context.process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const writeWarning = ({ context, message }: { context: CliContext; message: string }) => {
  context.process.stderr.write(`${message}\n`);
};

export { createContext, writeJson, writeWarning };
export type { CliContext };
