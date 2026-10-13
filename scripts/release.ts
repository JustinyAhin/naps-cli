#!/usr/bin/env bun
// Build, compress, checksum, and upload naps-cli release artifacts to R2.
import { CryptoHasher, S3Client, gzipSync } from "bun";
import { readdir, unlink, writeFile } from "node:fs/promises";
import packageJson from "../package.json";
import { RELEASE_NAMESPACE, RELEASE_PUBLIC_KEY } from "../src/release-signing";
import { withReleaseSigningKey } from "./release-key";
import { validateReleaseOAuth } from "./release-oauth";
import {
  BRIDGE_VERSION,
  MULTIPART_OPTIONS,
  UPLOAD_CONCURRENCY,
  VERSION_PATTERN,
  artifact,
  buildBinaryUploadPlan,
  compareVersions,
  mapConcurrent,
  parseCfVersion,
  parseManifest,
  parseTemporaryCredentials,
  resolveCfAccountId,
  totalBytes,
  type TemporaryCredentials,
  type UploadArtifact,
  type VersionsManifest,
} from "./release-utils";

const BUCKET = "naps-cli-releases";
const DIST_DIR = "./dist";
const VERSIONS_URL = "https://dl.naps.sh/versions.json";
const signingKey = process.env.NAPS_CLI_SIGNING_KEY;
const signingKeyContent = process.env.NAPS_CLI_SIGNING_KEY_CONTENT;
delete process.env.NAPS_CLI_SIGNING_KEY_CONTENT;
delete process.env.NAPS_CLI_SIGNING_KEY;
const dryRun = process.argv.slice(2).includes("--dry-run");
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
if (unexpectedArguments.length > 0) {
  console.error("Usage: bun run release [--dry-run]");
  process.exit(1);
}

const version = `v${packageJson.version}`;
if (!VERSION_PATTERN.test(version)) {
  console.error(`Invalid package version: ${packageJson.version}`);
  process.exit(1);
}
if (!process.env.NAPS_GSC_CLIENT_SECRET) {
  console.error(
    "NAPS_GSC_CLIENT_SECRET is required to embed the Google Desktop OAuth credential in release binaries.",
  );
  process.exit(1);
}

const run = async ({
  command,
  args,
  accountId,
  stdout = "inherit",
  stderr = "inherit",
}: {
  command: string;
  args: string[];
  accountId?: string;
  stdout?: "inherit" | "pipe";
  stderr?: "inherit" | "pipe";
}) => {
  const env = { ...process.env };
  if (command === "cf" && accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  delete env.NAPS_CLI_SIGNING_KEY_CONTENT;
  delete env.NAPS_CLI_SIGNING_KEY;
  delete env.NAPS_GSC_REFRESH_TOKEN;
  delete env.CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID;
  if (command !== "cf") delete env.CLOUDFLARE_API_TOKEN;
  if (!(command === "bun" && args.includes("scripts/build.ts"))) {
    delete env.NAPS_GSC_CLIENT_SECRET;
  }
  const proc = Bun.spawn([command, ...args], { stdout, stderr, env });
  const code = await proc.exited;
  const output = stdout === "pipe" ? await new Response(proc.stdout).text() : "";
  if (code !== 0) throw new Error(`${command} command failed`);
  return output.trim();
};

const sha256OfFile = async ({ path }: { path: string }) => {
  const hasher = new CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
};

const signFile = async ({ path, signingKeyPath }: { path: string; signingKeyPath: string }) => {
  await run({
    command: "ssh-keygen",
    args: ["-Y", "sign", "-q", "-f", signingKeyPath, "-n", RELEASE_NAMESPACE, path],
  });
};

const formatBytes = ({ bytes }: { bytes: number }) => {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 || unit === "B" ? 0 : 1)} ${unit}`;
};

const checkGitState = async () => {
  const status = await run({ command: "git", args: ["status", "--porcelain"], stdout: "pipe" });
  if (status) throw new Error("working tree is not clean");
  const branch = await run({ command: "git", args: ["branch", "--show-current"], stdout: "pipe" });
  if (branch !== "main") throw new Error(`release must run from main (current: ${branch})`);
  await run({ command: "git", args: ["fetch", "--quiet", "origin", "main"] });
  const head = await run({ command: "git", args: ["rev-parse", "HEAD"], stdout: "pipe" });
  const originMain = await run({
    command: "git",
    args: ["rev-parse", "origin/main"],
    stdout: "pipe",
  });
  if (head !== originMain) throw new Error("main must exactly match origin/main");
};

const checkCfAuth = async () => {
  const cfVersion = parseCfVersion({
    output: await run({ command: "cf", args: ["--version"], stdout: "pipe", stderr: "pipe" }),
  });
  if (compareVersions({ left: `v${cfVersion.join(".")}`, right: "v0.6.0" }) < 0) {
    throw new Error("cf 0.6.0 or newer is required");
  }
  return resolveCfAccountId({
    hasApiToken: Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim()),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    getWhoami: () =>
      run({
        command: "cf",
        args: ["auth", "whoami", "--quiet"],
        stdout: "pipe",
        stderr: "pipe",
      }),
  });
};

const fetchManifest = async () => {
  const response = await fetch(VERSIONS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not read versions.json (${response.status})`);
  return parseManifest({ value: await response.json() });
};

const nextManifest = ({ existing }: { existing: VersionsManifest }): VersionsManifest => {
  if (compareVersions({ left: version, right: existing.latest }) < 0) {
    throw new Error(`refusing to publish ${version} behind ${existing.latest}`);
  }
  return {
    latest: version,
    versions: Array.from(new Set([...existing.versions, version])).sort((left, right) =>
      compareVersions({ left, right }),
    ),
  };
};

const createTemporaryCredentials = async ({
  parentAccessKeyId,
  accountId,
}: {
  parentAccessKeyId: string;
  accountId: string;
}): Promise<TemporaryCredentials> => {
  const args = [
    "r2",
    "temporary-credentials",
    "create",
    "--quiet",
    "--bucket",
    BUCKET,
    "--parent-access-key-id",
    parentAccessKeyId,
    "--permission",
    "object-read-write",
    "--ttl-seconds",
    "3600",
    "--prefixes",
    `cli/${version}/`,
    "--objects",
    "install.sh",
    "--objects",
    "install.ps1",
    "--objects",
    "versions.json",
    "--objects",
    "versions.json.sig",
  ];
  if (version === BRIDGE_VERSION) args.push("--prefixes", "cli/latest/");
  return parseTemporaryCredentials({
    output: await run({ command: "cf", args, accountId, stdout: "pipe", stderr: "pipe" }),
  });
};

const streamUpload = async ({ client, upload }: { client: S3Client; upload: UploadArtifact }) => {
  const startedAt = performance.now();
  const writer = client.file(upload.key).writer({
    ...MULTIPART_OPTIONS,
    type: upload.contentType,
  });
  for await (const chunk of Bun.file(upload.file).stream()) await writer.write(chunk);
  await writer.end();
  const seconds = (performance.now() - startedAt) / 1000;
  console.log(`  ✓ ${upload.key}  ${formatBytes({ bytes: upload.size })}  ${seconds.toFixed(1)}s`);
  return upload.size;
};

const uploadPhase = async ({
  label,
  client,
  uploads,
}: {
  label: string;
  client: S3Client;
  uploads: UploadArtifact[];
}) => {
  console.log(`\n→ ${label}`);
  const startedAt = performance.now();
  const sizes = await mapConcurrent({
    values: uploads,
    concurrency: UPLOAD_CONCURRENCY,
    mapper: async (upload) => streamUpload({ client, upload }),
  });
  const bytes = sizes.reduce((sum, size) => sum + size, 0);
  const seconds = (performance.now() - startedAt) / 1000;
  console.log(
    `  ${formatBytes({ bytes })} in ${seconds.toFixed(1)}s (${formatBytes({ bytes: bytes / Math.max(seconds, 0.001) })}/s)`,
  );
};

const printPlan = ({ uploads }: { uploads: UploadArtifact[] }) => {
  console.log(
    `\n→ upload plan (${uploads.length} objects, ${formatBytes({ bytes: totalBytes({ artifacts: uploads }) })})`,
  );
  for (const upload of uploads) {
    console.log(`  ${formatBytes({ bytes: upload.size }).padStart(9)}  ${upload.key}`);
  }
  console.log(
    `  concurrency: ${UPLOAD_CONCURRENCY} files × ${MULTIPART_OPTIONS.queueSize} parts; ${formatBytes({ bytes: MULTIPART_OPTIONS.partSize })} parts; ${MULTIPART_OPTIONS.retry} retries`,
  );
  console.log(`  legacy mirror: ${version === BRIDGE_VERSION ? "raw + checksum" : "disabled"}`);
};

const main = async ({ signingKeyPath }: { signingKeyPath: string }) => {
  console.log(`naps-cli release ${version}${dryRun ? " (dry run)" : ""}`);
  const signingPublicKey = await run({
    command: "ssh-keygen",
    args: ["-y", "-f", signingKeyPath],
    stdout: "pipe",
  });
  if (signingPublicKey.split(/\s+/).slice(0, 2).join(" ") !== RELEASE_PUBLIC_KEY) {
    throw new Error(
      "Release signing key does not match the public key pinned in installers and updater",
    );
  }
  console.log("\n→ validating Google OAuth release credentials");
  await validateReleaseOAuth();
  let accountId = "";
  let parentAccessKeyId = "";
  if (!dryRun) {
    parentAccessKeyId = process.env.CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID ?? "";
    if (!parentAccessKeyId) {
      throw new Error(
        "CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID is required; create a bucket-scoped R2 API token",
      );
    }
    console.log("\n→ checking repository state");
    await checkGitState();
    console.log("\n→ checking cf auth and account context");
    accountId = await checkCfAuth();
    console.log("  selected account; R2 permissions checked before upload");
  }

  console.log("\n→ checking CLI");
  await run({ command: "bun", args: ["run", "check"] });
  await run({ command: "bun", args: ["test"] });

  console.log("\n→ building binaries");
  await run({ command: "bun", args: ["run", "scripts/build.ts"] });
  const binaries = (await readdir(DIST_DIR))
    .filter(
      (file) =>
        file.startsWith("naps-cli-") &&
        !file.endsWith(".sha256") &&
        !file.endsWith(".gz") &&
        !file.endsWith(".sig"),
    )
    .sort();
  if (binaries.length === 0) throw new Error("no binaries in dist/ after build");

  console.log("\n→ compressing and generating checksums");
  for (const binary of binaries) {
    const localPath = `${DIST_DIR}/${binary}`;
    const hash = await sha256OfFile({ path: localPath });
    await writeFile(`${localPath}.gz`, gzipSync(await Bun.file(localPath).bytes(), { level: 6 }));
    await writeFile(`${localPath}.sha256`, `${hash}  cli/${version}/${binary}\n`);
    await signFile({ path: `${localPath}.sha256`, signingKeyPath });
    console.log(`  ${hash.slice(0, 12)}…  ${binary}`);
  }

  const existingManifest = await fetchManifest();
  const manifest = nextManifest({ existing: existingManifest });
  const manifestPath = `${DIST_DIR}/.versions-${version}.json`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await signFile({ path: manifestPath, signingKeyPath });
  try {
    const binaryUploads = buildBinaryUploadPlan({ version, binaries, distDir: DIST_DIR });
    const installerUploads = [
      artifact({ key: "install.sh", file: "./install.sh", contentType: "text/x-shellscript" }),
      artifact({ key: "install.ps1", file: "./install.ps1", contentType: "text/plain" }),
    ];
    const manifestUpload = artifact({
      key: "versions.json",
      file: manifestPath,
      contentType: "application/json",
    });
    const manifestSignatureUpload = artifact({
      key: "versions.json.sig",
      file: `${manifestPath}.sig`,
      contentType: "text/plain",
    });
    printPlan({
      uploads: [...binaryUploads, ...installerUploads, manifestSignatureUpload, manifestUpload],
    });
    if (dryRun) {
      console.log("\n✓ dry run complete; no credentials created and no R2 objects changed");
      return;
    }

    console.log("\n→ creating one-hour, release-scoped R2 credentials");
    const credentials = await createTemporaryCredentials({ parentAccessKeyId, accountId });
    const client = new S3Client({
      ...credentials,
      bucket: BUCKET,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    });
    const releaseStartedAt = performance.now();
    await uploadPhase({ label: `uploading ${version} artifacts`, client, uploads: binaryUploads });
    await uploadPhase({ label: "uploading install scripts", client, uploads: installerUploads });
    await uploadPhase({
      label: "publishing versions.json last",
      client,
      uploads: [manifestSignatureUpload],
    });
    await uploadPhase({
      label: "publishing versions.json last",
      client,
      uploads: [manifestUpload],
    });
    const seconds = (performance.now() - releaseStartedAt) / 1000;
    const bytes = totalBytes({
      artifacts: [...binaryUploads, ...installerUploads, manifestSignatureUpload, manifestUpload],
    });
    console.log(
      `\n✓ released ${version}: ${formatBytes({ bytes })} in ${seconds.toFixed(1)}s (${formatBytes({ bytes: bytes / Math.max(seconds, 0.001) })}/s)`,
    );
    console.log("  install: curl -fsSL https://naps.sh/cli/install.sh | sh");
    console.log(`  tag: git tag -a ${version} -m "<release notes>" && git push origin ${version}`);
  } finally {
    await unlink(manifestPath).catch(() => {});
    await unlink(`${manifestPath}.sig`).catch(() => {});
  }
};

try {
  await withReleaseSigningKey({ keyPath: signingKey, keyContent: signingKeyContent, run: main });
} catch (error) {
  console.error(`\nrelease failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
