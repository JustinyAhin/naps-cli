import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const providerSecret = "synthetic-provider-secret-for-launcher-test";

type LauncherRequest = { args: string[]; failure?: "infisical" | "varlock" };

const withLauncher = async (
  check: (run: (request: LauncherRequest) => ReturnType<typeof spawnSync>) => void | Promise<void>,
) => {
  const directory = await mkdtemp(join(tmpdir(), "naps launcher test "));
  const profile = join(directory, "profile");
  const temporary = join(directory, "tmp");
  const infisical = join(directory, "infisical.mjs");
  const binary = join(directory, "binary.mjs");
  try {
    await mkdir(profile);
    await mkdir(temporary);
    const schema = await readFile(join(repository, "env/dev/.env.schema"), "utf8");
    await writeFile(
      join(profile, ".env.schema"),
      schema.replace(
        "# @type=string\nNAPS_CLI_API_KEY=",
        "# @type=string @required\nNAPS_CLI_API_KEY=",
      ),
    );
    await writeFile(
      infisical,
      `#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
if (process.env.FIXTURE_FAILURE === "infisical") {
  console.error("Infisical session unavailable: check the token agent or login.");
  process.exit(42);
}
console.log("loader stdout diagnostic");
console.error("loader stderr diagnostic");
const args = process.argv.slice(2);
const separator = args.indexOf("--");
const result = spawnSync(args[separator + 1], args.slice(separator + 2), {
  env: {
    ...process.env,
    ...(process.env.FIXTURE_FAILURE === "varlock" ? {} : { NAPS_CLI_API_KEY: ${JSON.stringify(providerSecret)} }),
    INFISICAL_TOKEN: "synthetic-bootstrap-secret-for-launcher-test",
  },
  stdio: "inherit",
});
if (result.status !== 0) console.error("failed to wait for command termination: exit status " + result.status);
process.exit(result.status === 0 ? 0 : 1);
`,
      { mode: 0o700 },
    );
    await writeFile(
      binary,
      `#!/usr/bin/env bun
if (process.argv[2] === "error") {
  console.error(JSON.stringify({ error: { code: "FIXTURE_ERROR", hint: "Use a valid argument.", detail: process.env.NAPS_CLI_API_KEY } }));
  process.exit(17);
}
console.log(JSON.stringify({
  args: process.argv.slice(2),
  configured: !!process.env.NAPS_CLI_API_KEY,
  bootstrapPresent: !!process.env.INFISICAL_TOKEN,
  sensitive: process.env.NAPS_CLI_API_KEY,
}));
if (process.argv[2] === "metadata") {
  console.error(JSON.stringify({ seo: { providerCostUsd: null, metadata: { source: "fixture" } } }));
}
`,
      { mode: 0o700 },
    );
    const run = ({ args, failure }: LauncherRequest) => {
      const result = spawnSync("sh", [join(repository, "scripts/naps-cli-launcher.sh"), ...args], {
        cwd: directory,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          TMPDIR: temporary,
          VARLOCK_TELEMETRY_DISABLED: "1",
          NAPS_CLI_BINARY: binary,
          NAPS_CLI_INFISICAL_BIN: infisical,
          NAPS_CLI_VARLOCK_BIN: join(repository, "node_modules/.bin/varlock"),
          NAPS_CLI_VARLOCK_PATH: profile,
          FIXTURE_FAILURE: failure,
        },
      });
      expect(result.error).toBeUndefined();
      expect(String(result.stdout) + String(result.stderr)).not.toContain(providerSecret);
      expect(String(result.stdout) + String(result.stderr)).not.toContain(
        "synthetic-bootstrap-secret",
      );
      return result;
    };
    await check(run);
    expect(await readdir(temporary)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("launcher preserves success JSON, optional metadata, arguments, and Varlock redaction", async () => {
  await withLauncher((run) => {
    for (const command of ["success", "metadata"]) {
      const args = [command, "--", "--help", "a query with spaces, $quotes, and café"];
      const result = run({ args });
      expect(result.status).toBe(0);
      expect(JSON.parse(String(result.stdout))).toMatchObject({
        args,
        configured: true,
        bootstrapPresent: false,
      });
      if (command === "metadata") {
        expect(JSON.parse(String(result.stderr))).toEqual({
          seo: { providerCostUsd: null, metadata: { source: "fixture" } },
        });
      } else {
        expect(result.stderr).toBe("");
      }
    }
  });
});

test("launcher preserves a CLI JSON error and its exact nonzero exit without loader text", async () => {
  await withLauncher((run) => {
    const result = run({ args: ["error"] });
    expect(result.status).toBe(17);
    expect(result.stdout).toBe("");
    expect(JSON.parse(String(result.stderr))).toMatchObject({
      error: { code: "FIXTURE_ERROR", hint: "Use a valid argument." },
    });
  });
});

test("launcher reports actionable bootstrap failures without command stdout", async () => {
  await withLauncher((run) => {
    const infisical = run({ args: ["success"], failure: "infisical" });
    expect(infisical.status).toBe(42);
    expect(infisical.stdout).toBe("");
    expect(String(infisical.stderr)).toContain("Infisical credential bootstrap failed");
    expect(String(infisical.stderr)).toContain("check the token agent or login");

    const varlock = run({ args: ["success"], failure: "varlock" });
    expect(varlock.status).toBe(1);
    expect(varlock.stdout).toBe("");
    expect(String(varlock.stderr)).toContain("Varlock credential validation failed");
    expect(String(varlock.stderr)).toContain("NAPS_CLI_API_KEY");
  });
});

test("launcher offline discovery does not require credential bootstrap", async () => {
  await withLauncher((run) => {
    for (const args of [["agent-guide"], ["--version"], ["keywords", "--help"]]) {
      const result = run({ args, failure: "infisical" });
      expect(result.status).toBe(0);
      expect(JSON.parse(String(result.stdout)).args).toEqual(args);
      expect(result.stderr).toBe("");
    }
  });
});
