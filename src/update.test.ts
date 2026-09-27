import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { downloadBinary, updateCli } from "./update";

const temporaryDirectories: string[] = [];

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
    const checksum = `${sha256({ bytes })}  naps-cli-linux-x64\n`;
    const baseUrl = "https://downloads.test/cli/v0.4.0/naps-cli-linux-x64";
    const compressed = createFetcher({
      responses: {
        [`${baseUrl}.sha256`]: new Response(checksum),
        [`${baseUrl}.gz`]: new Response(gzipSync(bytes)),
      },
    });
    const gzipResult = await downloadBinary({
      baseUrl: "https://downloads.test",
      version: "v0.4.0",
      binaryName: "naps-cli-linux-x64",
      fetcher: compressed.fetcher,
      signal: AbortSignal.timeout(1_000),
    });
    expect(gzipResult.source).toBe("gzip");
    expect(gzipResult.bytes).toEqual(bytes);

    const raw = createFetcher({
      responses: {
        [`${baseUrl}.sha256`]: new Response(checksum),
        [baseUrl]: new Response(bytes),
      },
    });
    const rawResult = await downloadBinary({
      baseUrl: "https://downloads.test",
      version: "v0.4.0",
      binaryName: "naps-cli-linux-x64",
      fetcher: raw.fetcher,
      signal: AbortSignal.timeout(1_000),
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
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": Response.json({
          latest: "v0.4.0",
          versions: ["v0.3.1", "v0.4.0"],
        }),
        [`${binaryUrl}.sha256`]: new Response(`${sha256({ bytes })}  naps-cli-linux-x64\n`),
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
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": Response.json({
          latest: "v0.4.0",
          versions: ["v0.3.1", "v0.4.0"],
        }),
        [`${binaryUrl}.sha256`]: new Response(`${"0".repeat(64)}  naps-cli-linux-x64\n`),
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
      }),
    ).rejects.toMatchObject({ code: "UPDATE_VERIFICATION_FAILED" });
    expect(await readFile(executablePath, "utf8")).toBe("old binary");
  });

  test("refuses development execution before downloading an artifact", async () => {
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": Response.json({
          latest: "v0.4.0",
          versions: ["v0.3.1", "v0.4.0"],
        }),
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
      }),
    ).rejects.toThrow("installed naps-cli binary");
    expect(mock.calls).toEqual(["https://downloads.test/versions.json"]);
  });

  test("hands Windows updates to the installer", async () => {
    const mock = createFetcher({
      responses: {
        "https://downloads.test/versions.json": Response.json({
          latest: "v0.4.0",
          versions: ["v0.3.1", "v0.4.0"],
        }),
      },
    });
    const result = await updateCli({
      currentVersion: "0.3.1",
      env: { NAPS_CLI_BASE: "https://downloads.test" },
      executablePath: "C:\\naps-cli.exe",
      platform: "win32",
      architecture: "x64",
      fetch: mock.fetcher,
    });
    expect(result).toEqual({
      status: "windows",
      latestVersion: "v0.4.0",
      installCommand: "iwr -useb https://downloads.test/install.ps1 | iex",
    });
    expect(mock.calls).toHaveLength(1);
  });
});
