#!/usr/bin/env bun
import { Glob } from "bun";
import { rm } from "node:fs/promises";

const googleClientSecret = process.env.NAPS_GSC_CLIENT_SECRET ?? "";

const crossTargets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-windows-x64",
] as const;

const hostOnly = process.argv.slice(2).includes("--host");
const targets = hostOnly ? [undefined] : crossTargets;

await rm("./dist", { recursive: true, force: true });

const results = await Promise.all(
  targets.map(async (target) => {
    const outfile = target ? `./dist/naps-cli-${target.replace("bun-", "")}` : "./dist/naps-cli";
    const start = Date.now();
    const result = await Bun.build({
      entrypoints: ["./index.ts"],
      compile: { ...(target ? { target } : {}), outfile },
      minify: true,
      sourcemap: "inline",
      define: {
        NAPS_BUILD_GOOGLE_CLIENT_SECRET: JSON.stringify(googleClientSecret),
      },
    });
    return { target: target ?? "host", outfile, result, durationMs: Date.now() - start };
  }),
);

let failed = false;
for (const { target, outfile, result, durationMs } of results) {
  if (result.success) {
    console.log(`✓ ${target.padEnd(20)} ${outfile}  (${durationMs}ms)`);
  } else {
    failed = true;
    console.error(`✗ ${target}`);
    for (const log of result.logs) console.error(log);
  }
}

// Bun emits a stray ./dist/*.js.map next to the binary even with embedded
// sourcemaps; the binary already has the sourcemap baked in via zstd.
const strayMaps = new Glob("./dist/*.js.map");
for await (const path of strayMaps.scan(".")) await rm(path);

if (failed) process.exit(1);
