import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { downloadBinary, updateCli } from "./update";

const temporaryDirectories: string[] = [];
let signingDirectory: string;
let signingPublicKey: string;
let signatureCount = 0;

beforeAll(async () => {
  signingDirectory = await mkdtemp(join(tmpdir(), "naps-cli-test-signing-"));
  const key = join(signingDirectory, "key");
  const result = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  if (result.status !== 0) throw new Error("could not create test signing key");
  signingPublicKey = (await readFile(`${key}.pub`, "utf8")).split(/\s+/).slice(0, 2).join(" ");
});

afterAll(async () => {
  await rm(signingDirectory, { recursive: true, force: true });
});

const sign = async (content: string) => {
  const path = join(signingDirectory, `signed-${signatureCount++}`);
  await writeFile(path, content);
  const result = spawnSync("ssh-keygen", [
    "-Y",
    "sign",
    "-q",
    "-f",
    join(signingDirectory, "key"),
    "-n",
    "naps-cli-release",
    path,
  ]);
  if (result.status !== 0) throw new Error("could not sign test data");
  return readFile(`${path}.sig`, "utf8");
};

const sha256 = ({ bytes }: { bytes: Uint8Array }) =>
  createHash("sha256").update(bytes).digest("hex");

const createFetcher = ({ responses }: { responses: Record<string, Response> }) => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return responses[url]?.clone() ?? new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("CLI updater", () => {
  test("downloads gzip and falls back to a raw artifact", async () => {
    const bytes = new TextEncoder().encode("new binary");
    const checksum = `${sha256({ bytes })}  cli/v0.4.0/naps-cli-linux-x64\n`;
    const signature = await sign(checksum);
    const baseUrl = "https://downloads.test/cli/v0.4.0/naps-cli-linux-x64";
    const compressed = createFetcher({
      responses: {
        [`${baseUrl}.sha256`]: new Response(checksum),
        [`${baseUrl}.sha256.sig`]: new Response(signature),
        [`${baseUrl}.gz`]: new Response(gzipSync(bytes)),
      },
    });
    const gzipResult = await downloadBinary({
      baseUrl: "https://downloads.test",
      version: "v0.4.0",
      binaryName: "naps-cli-linux-x64",
      fetcher: compressed.fetcher,
      signal: AbortSignal.timeout(1_000),
      signingPublicKey,
    });
    expect(gzipResult.source).toBe("gzip");
    expect(gzipResult.bytes).toEqual(bytes);

    const raw = createFetcher({
      responses: {
        [`${baseUrl}.sha256`]: new Response(checksum),
        [`${baseUrl}.sha256.sig`]: new Response(signature),
        [baseUrl]: new Response(bytes),
      },
    });
    const rawResult = await downloadBinary({
      baseUrl: "https://downloads.test",
      version: "v0.4.0",
      binaryName: "naps-cli-linux-x64",
      fetcher: raw.fetcher,
      signal: AbortSignal.timeout(1_000),
      signingPublicKey,
    });
    expect(rawResult.source).toBe("raw");
    expect(rawResult.bytes).toEqual(bytes);
  });

  test("updates an installed POSIX binary atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "naps-cli-update-"));
    temporaryDirectories.push(directory);
    const executablePath = join(directory, "naps-cli");
    await writeFile(executablePath, "old binary");
    await chmod(executablePath, 0o755);
    const bytes = new TextEncoder().encode("new binary");
    const binaryUrl = "https://downloads.test/cli/v0.4.0/naps-cli-linux-x64";
    const manifest = JSON.stringify({ latest: "v0.4.0", versions: ["v0.3.1", "v0.4.0"] });
    const checksum = `${sha256({ bytes })}  cli/v0.4.0/naps-cli-linux-x64\n`;
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": new Response(manifest),
        "https://downloads.test/versions.json.sig": new Response(await sign(manifest)),
        [`${binaryUrl}.sha256`]: new Response(checksum),
        [`${binaryUrl}.sha256.sig`]: new Response(await sign(checksum)),
        [`${binaryUrl}.gz`]: new Response(gzipSync(bytes)),
      },
    });

    const result = await updateCli({
      currentVersion: "0.3.1",
      env: { NAPS_CLI_BASE: "https://downloads.test" },
      executablePath,
      platform: "linux",
      architecture: "x64",
      fetch: mock.fetcher,
      signingPublicKey,
    });

    expect(result).toEqual({ status: "updated", latestVersion: "v0.4.0", source: "gzip" });
    expect(await readFile(executablePath, "utf8")).toBe("new binary");
  });

  test("does not alter the executable on checksum failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "naps-cli-update-"));
    temporaryDirectories.push(directory);
    const executablePath = join(directory, "naps-cli");
    await writeFile(executablePath, "old binary");
    const bytes = new TextEncoder().encode("new binary");
    const binaryUrl = "https://downloads.test/cli/v0.4.0/naps-cli-linux-x64";
    const manifest = JSON.stringify({ latest: "v0.4.0", versions: ["v0.3.1", "v0.4.0"] });
    const checksum = `${"0".repeat(64)}  cli/v0.4.0/naps-cli-linux-x64\n`;
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": new Response(manifest),
        "https://downloads.test/versions.json.sig": new Response(await sign(manifest)),
        [`${binaryUrl}.sha256`]: new Response(checksum),
        [`${binaryUrl}.sha256.sig`]: new Response(await sign(checksum)),
        [`${binaryUrl}.gz`]: new Response(gzipSync(bytes)),
      },
    });

    await expect(
      updateCli({
        currentVersion: "0.3.1",
        env: { NAPS_CLI_BASE: "https://downloads.test" },
        executablePath,
        platform: "linux",
        architecture: "x64",
        fetch: mock.fetcher,
        signingPublicKey,
      }),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFICATION_FAILED" });
    expect(await readFile(executablePath, "utf8")).toBe("old binary");
  });

  test("refuses development execution before downloading an artifact", async () => {
    const manifest = JSON.stringify({ latest: "v0.4.0", versions: ["v0.3.1", "v0.4.0"] });
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": new Response(manifest),
        "https://downloads.test/versions.json.sig": new Response(await sign(manifest)),
      },
    });
    await expect(
      updateCli({
        currentVersion: "0.3.1",
        env: { NAPS_CLI_BASE: "https://downloads.test" },
        executablePath: process.execPath,
        platform: "linux",
        architecture: "x64",
        fetch: mock.fetcher,
        signingPublicKey,
      }),
    ).rejects.toThrow("installed naps-cli binary");
    expect(mock.calls).toEqual([
      "https://downloads.test/versions.json",
      "https://downloads.test/versions.json.sig",
    ]);
  });

  test("hands Windows updates to the installer", async () => {
    const manifest = JSON.stringify({ latest: "v0.4.0", versions: ["v0.3.1", "v0.4.0"] });
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": new Response(manifest),
        "https://downloads.test/versions.json.sig": new Response(await sign(manifest)),
      },
    });
    const result = await updateCli({
      currentVersion: "0.3.1",
      env: { NAPS_CLI_BASE: "https://downloads.test" },
      executablePath: "C:\\naps-cli.exe",
      platform: "win32",
      architecture: "x64",
      fetch: mock.fetcher,
      signingPublicKey,
    });
    expect(result).toEqual({
      status: "windows",
      latestVersion: "v0.4.0",
      installCommand: "iwr -useb https://naps.sh/cli/install.ps1 | iex",
    });
    expect(mock.calls).toHaveLength(2);
  });

  test("rejects a forged checksum signature", async () => {
    const checksum = `${"0".repeat(64)}  cli/v0.4.0/naps-cli-linux-x64\n`;
    const signature = await sign(checksum);
    const baseUrl = "https://downloads.test/cli/v0.4.0/naps-cli-linux-x64";
    const mock = createFetcher({
      responses: {
        [`${baseUrl}.sha256`]: new Response(checksum.replace("0", "1")),
        [`${baseUrl}.sha256.sig`]: new Response(signature),
      },
    });
    await expect(
      downloadBinary({
        baseUrl: "https://downloads.test",
        version: "v0.4.0",
        binaryName: "naps-cli-linux-x64",
        fetcher: mock.fetcher,
        signal: AbortSignal.timeout(1_000),
        signingPublicKey,
      }),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFICATION_FAILED" });
    expect(mock.calls).toHaveLength(2);
  });

  test("refuses a tampered signed manifest before downloading or replacing the executable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "naps-cli-update-"));
    temporaryDirectories.push(directory);
    const executablePath = join(directory, "naps-cli");
    await writeFile(executablePath, "old binary");
    const manifest = JSON.stringify({ latest: "v0.4.0", versions: ["v0.3.1", "v0.4.0"] });
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": new Response(
          manifest.replaceAll("v0.4.0", "v0.5.0"),
        ),
        "https://downloads.test/versions.json.sig": new Response(await sign(manifest)),
      },
    });
    await expect(
      updateCli({
        currentVersion: "0.3.1",
        env: { NAPS_CLI_BASE: "https://downloads.test" },
        executablePath,
        platform: "linux",
        architecture: "x64",
        fetch: mock.fetcher,
        signingPublicKey,
      }),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFICATION_FAILED" });
    expect(await readFile(executablePath, "utf8")).toBe("old binary");
    expect(mock.calls).toEqual([
      "https://downloads.test/versions.json",
      "https://downloads.test/versions.json.sig",
    ]);
  });

  test("rejects a valid checksum signed for another version", async () => {
    const checksum = `${"0".repeat(64)}  cli/v0.3.1/naps-cli-linux-x64\n`;
    const baseUrl = "https://downloads.test/cli/v0.4.0/naps-cli-linux-x64";
    const mock = createFetcher({
      responses: {
        [`${baseUrl}.sha256`]: new Response(checksum),
        [`${baseUrl}.sha256.sig`]: new Response(await sign(checksum)),
      },
    });
    await expect(
      downloadBinary({
        baseUrl: "https://downloads.test",
        version: "v0.4.0",
        binaryName: "naps-cli-linux-x64",
        fetcher: mock.fetcher,
        signal: AbortSignal.timeout(1_000),
        signingPublicKey,
      }),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFICATION_FAILED" });
    expect(mock.calls).toHaveLength(2);
  });
});
