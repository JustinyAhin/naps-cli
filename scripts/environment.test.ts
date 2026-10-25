import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Profile = "dev" | "build" | "release";

const repository = fileURLToPath(new URL("../", import.meta.url));
const runtimeNames = [
  "NAPS_CLI_API_KEY",
  "NAPS_CLI_SEO_API_TOKEN",
  "NAPS_CLI_REDDIT_API_TOKEN",
  "NAPS_CLI_TWITTERAPI_TOKEN",
  "NAPS_CLI_X_BEARER_TOKEN",
  "NAPS_CLI_TREG_TOKEN",
  "NAPS_CLI_TREG_ORG",
  "NAPS_GSC_REFRESH_TOKEN",
  "NAPS_GSC_CLIENT_ID",
];
const runtimeAliases = [
  "SEO_API_TOKEN",
  "TWITTERAPI_API_KEY",
  "X_BEARER_TOKEN",
  "TREG_TOKEN",
  "TREG_ORG",
];
const releaseNames = [
  "NAPS_CLI_SIGNING_KEY",
  "NAPS_CLI_SIGNING_KEY_CONTENT",
  "CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID",
  "CLOUDFLARE_ACCOUNT_ID",
];
const bootstrapNames = [
  "OP_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_ENVIRONMENT_ID",
  "INFISICAL_TOKEN",
  "INFISICAL_CLIENT_ID",
  "INFISICAL_CLIENT_SECRET",
  "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID",
  "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET",
  "INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN",
];
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
  NAPS_CLI_TREG_TOKEN: "FAKE_PROVIDER_TREG_TOKEN",
  NAPS_CLI_TREG_ORG: "fake-treg-team",
  NAPS_GSC_REFRESH_TOKEN: "FAKE_PROVIDER_GSC_REFRESH_TOKEN",
  NAPS_GSC_CLIENT_SECRET: "FAKE_PROVIDER_GSC_CLIENT_SECRET",
  NAPS_CLI_SIGNING_KEY: "/fake/release-key-not-read",
  CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID: "FAKE_PROVIDER_R2_PARENT_ID",
  CLOUDFLARE_ACCOUNT_ID: "FAKE_PROVIDER_CLOUDFLARE_ACCOUNT",
  EXTRA_PROVIDER_SECRET: "FAKE_UNREQUESTED_PROVIDER_SECRET",
};

const inherited = (names: string[]) =>
  Object.fromEntries(names.map((name) => [name, `FAKE_INHERITED_${name}`]));

const runFixture = async ({
  profile,
  expected = {},
  absent = [],
  ambient = {},
  injected = {},
  injectedByPath = {},
  secretReferences = {},
  fail = false,
  failPath = "",
}: {
  profile: Profile;
  expected?: Record<string, string>;
  absent?: string[];
  ambient?: Record<string, string>;
  injected?: Record<string, string>;
  injectedByPath?: Record<string, Record<string, string>>;
  secretReferences?: Record<string, string>;
  fail?: boolean;
  failPath?: string;
}) => {
  const directory = await mkdtemp(join(tmpdir(), "naps-environment-test-"));
  const schemaDirectory = join(directory, "env", profile);

  try {
    await mkdir(schemaDirectory, { recursive: true });
    await mkdir(join(directory, "bin"));
    await symlink(join(repository, "node_modules"), join(directory, "node_modules"));

    const schema = await readFile(join(repository, "env", profile, ".env.schema"), "utf8");
    expect(schema).not.toContain("@import");
    expect(schema).not.toContain("@initOp");
    expect(schema).not.toContain("@varlock/1password-plugin");
    await writeFile(
      join(directory, ".infisical.json"),
      await readFile(join(repository, ".infisical.json")),
    );
    await writeFile(join(schemaDirectory, ".env.schema"), schema);
    await writeFile(
      join(directory, "bunfig.toml"),
      await readFile(join(repository, "bunfig.toml")),
    );

    const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
    const script = packageJson.scripts[profile] as string;
    expect(script).toContain("bun --no-env-file ");
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          [profile]: `${script.split("bun --no-env-file ")[0]}bun --no-env-file inspect.ts`,
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
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(directory, "op-calls"))}, "unexpected");
console.error("1Password must not be called");
process.exit(1);
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
const path = args[args.indexOf("--path") + 1];
if (process.env.FIXTURE_PROVIDER_FAIL === "1" &&
    (!process.env.FIXTURE_PROVIDER_FAIL_PATH || process.env.FIXTURE_PROVIDER_FAIL_PATH === path)) {
  console.error("Simulated Infisical failure");
  process.exit(1);
}
const separator = args.indexOf("--");
if (separator === -1 || separator === args.length - 1) process.exit(1);
const byPath = ${JSON.stringify(injectedByPath)};
const values = byPath[path] ?? ${JSON.stringify(injected)};
const references = ${JSON.stringify(secretReferences)};
const expand = !args.includes("--expand=false");
const resolved = Object.fromEntries(Object.entries(values).map(([name, value]) => [
  name, expand && value in references ? references[value] : value,
]));
const result = spawnSync(args[separator + 1], args.slice(separator + 2), {
  env: { ...process.env, ...resolved },
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
        FIXTURE_PROVIDER_FAIL_PATH: failPath,
        ...ambient,
      },
    });
    expect(result.error).toBeUndefined();
    const started = await Bun.file(join(directory, "child-started")).exists();
    expect(await Bun.file(join(directory, "op-calls")).exists()).toBe(false);
    if (fail) {
      expect(result.status).not.toBe(0);
      expect(started).toBe(false);
      expect(await Bun.file(join(directory, "infisical-calls")).exists()).toBe(true);
      expect(result.stderr).toContain("Simulated Infisical failure");
      return;
    }

    expect(result.status, result.stderr).toBe(0);
    expect(started).toBe(true);
    const infisicalCalls = (await readFile(join(directory, "infisical-calls"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const scopes =
      profile === "dev"
        ? [
            { projectId: "1dc4d864-c7a3-41fe-804f-d60495474d5b", environment: "dev", path: "/cli" },
            {
              projectId: "47601232-b64a-4c18-b61e-fcaebcffb68e",
              environment: "prod",
              path: "/build",
            },
          ]
        : [
            {
              projectId: "47601232-b64a-4c18-b61e-fcaebcffb68e",
              environment: "prod",
              path: `/${profile}`,
            },
          ];
    expect(infisicalCalls).toHaveLength(scopes.length);
    for (const [index, scope] of scopes.entries()) {
      const args = infisicalCalls[index]!;
      expect(args.slice(0, args.indexOf("--"))).toEqual([
        "run",
        `--projectId=${scope.projectId}`,
        "--env",
        scope.environment,
        "--path",
        scope.path,
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

test("development combines shared runtime credentials and the maintainer Google secret without release or loader inputs", async () => {
  const runtime = Object.fromEntries(
    runtimeNames
      .filter((name) => name !== "NAPS_GSC_CLIENT_ID")
      .map((name) => [name, providerValues[name]!]),
  );
  const google = { NAPS_GSC_CLIENT_SECRET: providerValues.NAPS_GSC_CLIENT_SECRET! };
  await runFixture({
    profile: "dev",
    injectedByPath: { "/cli": runtime, "/build": google },
    expected: { ...runtime, ...google },
    absent: ["NAPS_GSC_CLIENT_ID", ...releaseNames],
    ambient: inherited([...releaseNames, ...bootstrapNames]),
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

test("release preserves Infisical Google and signing inputs but disables loaded and inherited cf token aliases", async () => {
  const injected = {
    NAPS_GSC_CLIENT_SECRET: "FAKE_INFISICAL_CLIENT_SECRET",
    NAPS_GSC_REFRESH_TOKEN: "FAKE_INFISICAL_REFRESH_TOKEN",
    NAPS_CLI_SIGNING_KEY_CONTENT: fakeSigningKey,
    CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID: "FAKE_INFISICAL_PARENT_ACCESS_ID",
    CLOUDFLARE_ACCOUNT_ID: "FAKE_INFISICAL_ACCOUNT_ID",
  };
  await runFixture({
    profile: "release",
    injected: {
      ...injected,
      NAPS_GSC_CLIENT_SECRET: "${prod.build.NAPS_GSC_CLIENT_SECRET}",
      CLOUDFLARE_API_TOKEN: "FAKE_INFISICAL_UNUSED_API_TOKEN",
    },
    secretReferences: {
      "${prod.build.NAPS_GSC_CLIENT_SECRET}": injected.NAPS_GSC_CLIENT_SECRET,
    },
    expected: { ...injected, CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "" },
    absent: [
      ...runtimeNames.filter((name) => name !== "NAPS_GSC_REFRESH_TOKEN"),
      ...runtimeAliases,
      "NAPS_CLI_SIGNING_KEY",
    ],
    ambient: inherited([
      ...runtimeNames.filter((name) => !name.startsWith("NAPS_GSC_")),
      ...runtimeAliases,
      ...bootstrapNames,
      "CLOUDFLARE_API_TOKEN",
      "CF_API_TOKEN",
    ]),
  });
}, 30_000);

test("an Infisical failure prevents the maintainer application child from starting", async () => {
  await runFixture({ profile: "release", fail: true });
}, 30_000);

test("a shared Infisical failure prevents source development from starting", async () => {
  await runFixture({ profile: "dev", fail: true, failPath: "/cli" });
}, 30_000);

test("a Google secret Infisical failure prevents source development from starting", async () => {
  await runFixture({ profile: "dev", fail: true, failPath: "/build" });
}, 30_000);
