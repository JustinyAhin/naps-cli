#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./src/cli/app";
import { createContext } from "./src/cli/context";

await run(app, process.argv.slice(2), createContext());

if (process.exitCode && Number(process.exitCode) !== 0) {
  process.exitCode = 1;
}
