import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

type Profile = "dev" | "build" | "release";

const repository = fileURLToPath(new URL("../", import.meta.url));
const runtimeNames = [
  "NAPS_CLI_API_KEY",
  "NAPS_CLI_SEO_API_TOKEN",
  "NAPS_CLI_REDDIT_API_TOKEN",
  "NAPS_CLI_TWITTERAPI_TOKEN",
  "NAPS_CLI_X_BEARER_TOKEN",
  "NAPS_GSC_REFRESH_TOKEN",
  "NAPS_GSC_CLIENT_ID",
];
const runtimeAliases = ["SEO_API_TOKEN", "TWITTERAPI_API_KEY", "X_BEARER_TOKEN"];
const releaseNames = [
  "NAPS_CLI_SIGNING_KEY",
  "NAPS_CLI_SIGNING_KEY_CONTENT",
  "CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];
const bootstrapNames = [
  "OP_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_ENVIRONMENT_ID",
  "INFISICAL_TOKEN",
  "INFISICAL_CLIENT_ID",
  "INFISICAL_CLIENT_SECRET",
];
const fakeToken = "ops_ISOLATED_ENVIRONMENT_TEST_TOKEN";
const fakeSigningKey = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "FAKE_FIRST_LINE_WITH_NO_SIGNING_CAPABILITY",
  "FAKE_SECOND_LINE_WITH_NO_SIGNING_CAPABILITY",
  "-----END OPENSSH PRIVATE KEY-----",
  "",
].join("\n");
const providerValues: Record<string, string> = {
  NAPS_CLI_API_KEY: "FAKE_PROVIDER_NAPS_API_KEY",
  NAPS_CLI_SEO_API_TOKEN: "FAKE_PROVIDER_SEO_TOKEN",
  NAPS_CLI_REDDIT_API_TOKEN: "FAKE_PROVIDER_REDDIT_TOKEN",
  NAPS_CLI_TWITTERAPI_TOKEN: "FAKE_PROVIDER_TWITTER_TOKEN",
  NAPS_CLI_X_BEARER_TOKEN: "FAKE_PROVIDER_X_TOKEN",
  NAPS_GSC_REFRESH_TOKEN: "FAKE_PROVIDER_GSC_REFRESH_TOKEN",
  NAPS_GSC_CLIENT_SECRET: "FAKE_PROVIDER_GSC_CLIENT_SECRET",
  NAPS_CLI_SIGNING_KEY: "/fake/release-key-not-read",
  CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID: "FAKE_PROVIDER_R2_PARENT_ID",
  CLOUDFLARE_API_TOKEN: "FAKE_PROVIDER_CLOUDFLARE_TOKEN",
  CLOUDFLARE_ACCOUNT_ID: "FAKE_PROVIDER_CLOUDFLARE_ACCOUNT",
  EXTRA_PROVIDER_SECRET: "FAKE_UNREQUESTED_PROVIDER_SECRET",
};

const inherited = (names: string[]) =>
  Object.fromEntries(names.map((name) => [name, `FAKE_INHERITED_${name}`]));

const runFixture = async ({
  profile,
  machineLines = [],
  expected = {},
  absent = [],
  ambient = {},
  references = {},
  injected = {},
  fail = false,
}: {
  profile: Profile;
  machineLines?: string[];
  expected?: Record<string, string>;
  absent?: string[];
  ambient?: Record<string, string>;
  references?: Record<string, string>;
  injected?: Record<string, string>;
  fail?: boolean;
}) => {
  const directory = await mkdtemp(join(tmpdir(), "naps-environment-test-"));
  const schemaDirectory = join(directory, "env", profile);

  try {
    await mkdir(schemaDirectory, { recursive: true });
    await mkdir(join(directory, "machine"));
    await mkdir(join(directory, "bin"));
    await symlink(join(repository, "node_modules"), join(directory, "node_modules"));

    const schema = await readFile(join(repository, "env", profile, ".env.schema"), "utf8");
    const importPath = schema.match(/@import\((~\/\.config\/varlock\/naps-cli\/[^,]+),/)?.[1];
    const machineConfiguration = join(directory, "machine", ".env.dev");
    let fixtureSchema = schema;
    if (profile === "dev") {
      expect(importPath).toBeDefined();
      expect(basename(importPath!)).toBe(".env.dev");
      fixtureSchema = schema.replace(importPath!, machineConfiguration);
    } else {
      expect(importPath).toBeUndefined();
      expect(schema).not.toContain("@initOp");
      expect(machineLines).toHaveLength(0);
      await writeFile(
        join(directory, ".infisical.json"),
        await readFile(join(repository, ".infisical.json")),
      );
    }
    expect(fixtureSchema).not.toContain("~/.config/varlock/naps-cli");
    await writeFile(join(schemaDirectory, ".env.schema"), fixtureSchema);
    await writeFile(
      join(directory, "bunfig.toml"),
      await readFile(join(repository, "bunfig.toml")),
    );

    const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
    const script = packageJson.scripts[profile] as string;
    expect(script).toContain("-- bun --no-env-file ");
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          [profile]: `${script.split("-- bun --no-env-file ")[0]}-- bun --no-env-file inspect.ts`,
        },
      }),
    );

    await writeFile(
      join(directory, ".env"),
      "NAPS_CLI_API_KEY=FAKE_STALE_DOTENV_KEY\nFIXTURE_FILE_ONLY=FAKE_FILE_ONLY_VALUE\n",
    );
    await writeFile(
      join(directory, ".env.local"),
      "NAPS_GSC_CLIENT_ID=FAKE_STALE_CLIENT_ID\nNAPS_GSC_CLIENT_SECRET=FAKE_STALE_CLIENT_SECRET\n",
    );
    if (machineLines.length) {
      await writeFile(machineConfiguration, `${machineLines.join("\n")}\n`, { mode: 0o600 });
    }

    await writeFile(
      join(directory, "inspect.ts"),
      `import { writeFileSync } from "node:fs";
const expected = ${JSON.stringify(expected)};
const absent = ${JSON.stringify([
        ...bootstrapNames,
        "__VARLOCK_ENV",
        "EXTRA_PROVIDER_SECRET",
        "FIXTURE_FILE_ONLY",
        ...absent,
      ])};
writeFileSync("child-started", "yes");
console.log("ENVIRONMENT_TEST_RESULT=" + JSON.stringify({
  expected: Object.entries(expected).every(([name, value]) => process.env[name] === value),
  mismatched: Object.entries(expected).filter(([name, value]) => process.env[name] !== value).map(([name]) => name),
  absent: absent.every((name) => !(name in process.env)),
}));
`,
    );

    await writeFile(
      join(directory, "bin", "op"),
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(directory, "op-calls"))}, JSON.stringify({
  args,
  fixtureTokenMatches: process.env.OP_SERVICE_ACCOUNT_TOKEN === ${JSON.stringify(fakeToken)},
}) + "\\n");
if (process.env.OP_SERVICE_ACCOUNT_TOKEN !== ${JSON.stringify(fakeToken)}) {
  console.error("Unexpected fixture authentication");
  process.exit(1);
}
if (process.env.FIXTURE_PROVIDER_FAIL === "1") {
  console.error("Simulated provider failure");
  process.exit(1);
}
if (args[0] === "environment" && args[1] === "read" && args[2] === "fixture-environment") {
  const values = ${JSON.stringify(providerValues)};
  process.stdout.write(Object.entries(values).map(([name, value]) => name + "=" + value).join("\\n") + "\\n");
} else if (args[0] === "read") {
  const reference = args.find((value) => value.startsWith("op://"));
  const values = ${JSON.stringify(references)};
  if (!reference || !(reference in values)) process.exit(1);
  process.stdout.write(values[reference]);
} else if (args[0] === "inject") {
  const templatePath = args[args.indexOf("-i") + 1];
  const values = ${JSON.stringify(references)};
  const template = readFileSync(templatePath, "utf8");
  process.stdout.write(template.replace(/\\{\\{\\s*(op:\\/\\/.*?)\\s*\\}\\}/g, (_, reference) => {
    if (!(reference in values)) throw new Error("Unexpected fixture reference");
    return values[reference];
  }));
} else {
  process.exit(1);
}
`,
      { mode: 0o700 },
    );

    await writeFile(
      join(directory, "bin", "infisical"),
      `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(directory, "infisical-calls"))}, JSON.stringify(args) + "\\n");
if (args[0] !== "run") process.exit(1);
if (process.env.FIXTURE_PROVIDER_FAIL === "1") {
  console.error("Simulated Infisical failure");
  process.exit(1);
}
const separator = args.indexOf("--");
if (separator === -1 || separator === args.length - 1) process.exit(1);
const result = spawnSync(args[separator + 1], args.slice(separator + 2), {
  env: { ...process.env, ...${JSON.stringify(injected)} },
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
`,
      { mode: 0o700 },
    );

    const result = spawnSync(process.execPath, ["run", profile], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: `${join(directory, "bin")}:${join(repository, "node_modules", ".bin")}:${process.env.PATH}`,
        VARLOCK_TELEMETRY_DISABLED: "1",
        OP_SERVICE_ACCOUNT_TOKEN: "ops_FAKE_UNRELATED_INHERITED_TOKEN",
        FIXTURE_PROVIDER_FAIL: fail ? "1" : "0",
        ...ambient,
      },
    });
    expect(result.error).toBeUndefined();
    const started = await Bun.file(join(directory, "child-started")).exists();
    if (fail) {
      expect(result.status).not.toBe(0);
      expect(started).toBe(false);
      const provider = profile === "dev" ? "op" : "infisical";
      expect(await Bun.file(join(directory, `${provider}-calls`)).exists()).toBe(true);
      expect(result.stderr).toContain(
        profile === "dev" ? "Simulated provider failure" : "Simulated Infisical failure",
      );
      return;
    }

    const opCalls = (await Bun.file(join(directory, "op-calls")).exists())
      ? await readFile(join(directory, "op-calls"), "utf8")
      : "No fake op calls";
    expect(result.status, `${result.stderr}\nFake op calls: ${opCalls}`).toBe(0);
    expect(started).toBe(true);
    if (profile !== "dev") {
      expect(await Bun.file(join(directory, "op-calls")).exists()).toBe(false);
      const infisicalCalls = (await readFile(join(directory, "infisical-calls"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(infisicalCalls).toHaveLength(1);
      const args = infisicalCalls[0]!;
      expect(args.slice(0, args.indexOf("--"))).toEqual([
        "run",
        "--env",
        "prod",
        "--path",
        `/${profile}`,
        "--expand=false",
        "--secret-overriding=false",
      ]);
    }
    const line = result.stdout
      .split("\n")
      .find((value) => value.startsWith("ENVIRONMENT_TEST_RESULT="));
    expect(line, result.stdout).toBeDefined();
    expect(JSON.parse(line!.slice("ENVIRONMENT_TEST_RESULT=".length))).toEqual({
      expected: true,
      mismatched: [],
      absent: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("plain Bun startup ignores old dotenv files and leaves optional OAuth overrides absent", async () => {
  await runFixture({
    profile: "dev",
    absent: [...runtimeNames, "NAPS_GSC_CLIENT_SECRET", ...releaseNames],
    ambient: inherited(releaseNames),
  });
}, 30_000);

test("development loads only runtime credentials from its Environment", async () => {
  await runFixture({
    profile: "dev",
    machineLines: [
      "OP_ENVIRONMENT_ID=fixture-environment",
      `OP_TOKEN=${fakeToken}`,
      "NAPS_CLI_SIGNING_KEY_CONTENT=FAKE_UNIMPORTED_PRIVATE_KEY",
    ],
    expected: {
      ...Object.fromEntries(
        runtimeNames
          .filter((name) => name !== "NAPS_GSC_CLIENT_ID")
          .map((name) => [name, providerValues[name]]),
      ),
      NAPS_GSC_CLIENT_SECRET: providerValues.NAPS_GSC_CLIENT_SECRET!,
    },
    absent: ["NAPS_GSC_CLIENT_ID", ...releaseNames],
    ambient: inherited(releaseNames),
  });
}, 30_000);

test("development can load private vault references without an Environment", async () => {
  const reference = "op://fixture/runtime/api-key";
  const apiKey = "FAKE_PRIVATE_REFERENCE_API_KEY";
  await runFixture({
    profile: "dev",
    machineLines: [`OP_TOKEN=${fakeToken}`, `NAPS_CLI_API_KEY=op("${reference}")`],
    references: { [reference]: apiKey },
    expected: { NAPS_CLI_API_KEY: apiKey },
    absent: [
      ...runtimeNames.filter((name) => name !== "NAPS_CLI_API_KEY"),
      "NAPS_GSC_CLIENT_SECRET",
      ...releaseNames,
    ],
    ambient: inherited(releaseNames),
  });
}, 30_000);

test("build loads Infisical client secret and strips inherited runtime, release, and loader credentials", async () => {
  await runFixture({
    profile: "build",
    injected: { NAPS_GSC_CLIENT_SECRET: providerValues.NAPS_GSC_CLIENT_SECRET! },
    expected: { NAPS_GSC_CLIENT_SECRET: providerValues.NAPS_GSC_CLIENT_SECRET! },
    absent: [...runtimeNames, ...runtimeAliases, ...releaseNames],
    ambient: inherited([...runtimeNames, ...runtimeAliases, ...releaseNames, ...bootstrapNames]),
  });
}, 30_000);

test("release loads Infisical inputs and preserves the full multiline signing key", async () => {
  const injected = {
    NAPS_GSC_CLIENT_SECRET: "FAKE_INFISICAL_CLIENT_SECRET",
    NAPS_GSC_REFRESH_TOKEN: "FAKE_INFISICAL_REFRESH_TOKEN",
    NAPS_CLI_SIGNING_KEY_CONTENT: fakeSigningKey,
    CLOUDFLARE_API_TOKEN: "FAKE_INFISICAL_CLOUDFLARE_TOKEN",
    CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID: "FAKE_INFISICAL_PARENT_ACCESS_ID",
    CLOUDFLARE_ACCOUNT_ID: "FAKE_INFISICAL_ACCOUNT_ID",
  };
  await runFixture({
    profile: "release",
    injected,
    expected: injected,
    absent: [
      ...runtimeNames.filter((name) => name !== "NAPS_GSC_REFRESH_TOKEN"),
      ...runtimeAliases,
      "NAPS_CLI_SIGNING_KEY",
    ],
    ambient: inherited([
      ...runtimeNames.filter((name) => !name.startsWith("NAPS_GSC_")),
      ...runtimeAliases,
      ...bootstrapNames,
    ]),
  });
}, 30_000);

test("an Infisical failure prevents the maintainer application child from starting", async () => {
  await runFixture({ profile: "release", fail: true });
}, 30_000);

test("a configured provider failure prevents the application child from starting", async () => {
  await runFixture({
    profile: "dev",
    machineLines: ["OP_ENVIRONMENT_ID=fixture-environment", `OP_TOKEN=${fakeToken}`],
    fail: true,
  });
}, 30_000);
