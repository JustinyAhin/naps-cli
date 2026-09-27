import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { RELEASE_PUBLIC_KEY } from "./release-signing";

const temporaryDirectories: string[] = [];
let signingDirectory: string;
let signingPublicKey: string;
let testInstaller: string;
let signatureCount = 0;
const binaryName = `naps-cli-${process.platform}-${process.arch}`;

beforeAll(async () => {
  signingDirectory = await mkdtemp(join(tmpdir(), "naps-cli-installer-signing-"));
  const key = join(signingDirectory, "key");
  if (spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status !== 0) {
    throw new Error("could not create test signing key");
  }
  signingPublicKey = (await readFile(`${key}.pub`, "utf8")).split(/\s+/).slice(0, 2).join(" ");
  const installer = await readFile(join(import.meta.dir, "../install.sh"), "utf8");
  const windowsInstaller = await readFile(join(import.meta.dir, "../install.ps1"), "utf8");
  if (!installer.includes(RELEASE_PUBLIC_KEY) || !windowsInstaller.includes(RELEASE_PUBLIC_KEY)) {
    throw new Error("installers do not pin the release public key");
  }
  testInstaller = join(signingDirectory, "install.sh");
  await writeFile(
    testInstaller,
    installer.replace(/PUBLIC_KEY='ssh-ed25519 [^']+'/, `PUBLIC_KEY='${signingPublicKey}'`),
  );
});

afterAll(async () => {
  await rm(signingDirectory, { recursive: true, force: true });
});

const sign = async (content: string) => {
  const path = join(signingDirectory, `signed-${signatureCount++}`);
  await writeFile(path, content);
  if (
    spawnSync("ssh-keygen", [
      "-Y",
      "sign",
      "-q",
      "-f",
      join(signingDirectory, "key"),
      "-n",
      "naps-cli-release",
      path,
    ]).status !== 0
  ) {
    throw new Error("could not sign test data");
  }
  return readFile(`${path}.sig`, "utf8");
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("POSIX installer", () => {
  test.each(["gzip", "raw"] as const)("installs from the %s artifact", async (mode) => {
    const bytes = new TextEncoder().encode("#!/bin/sh\necho v0.4.0\n");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const checksumText = `${checksum}  cli/v0.4.0/${binaryName}\n`;
    const manifest = JSON.stringify({ latest: "v0.4.0", versions: ["v0.4.0"] });
    const manifestSignature = await sign(manifest);
    const checksumSignature = await sign(checksumText);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === `/${mode}/versions.json`) return new Response(manifest);
        if (path === `/${mode}/versions.json.sig`) return new Response(manifestSignature);
        if (path.endsWith(".sha256.sig")) return new Response(checksumSignature);
        if (path.endsWith(".sha256")) return new Response(checksumText);
        if (path.endsWith(".gz")) {
          return mode === "gzip"
            ? new Response(gzipSync(bytes))
            : new Response("missing", { status: 404 });
        }
        return new Response(bytes);
      },
    });
    const installDirectory = await mkdtemp(join(tmpdir(), "naps-cli-install-"));
    temporaryDirectories.push(installDirectory);

    try {
      const proc = Bun.spawn(["sh", testInstaller], {
        env: {
          ...process.env,
          NAPS_CLI_BASE: `http://127.0.0.1:${server.port}/${mode}`,
          NAPS_CLI_INSTALL_DIR: installDirectory,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      expect(exitCode, stderr).toBe(0);
      expect(new Uint8Array(await readFile(join(installDirectory, "naps-cli")))).toEqual(bytes);
    } finally {
      server.stop(true);
    }
  });

  test("rejects a bad checksum without replacing the installed binary", async () => {
    const bytes = new TextEncoder().encode("new binary");
    const badChecksum = `${"0".repeat(64)}  cli/v0.4.0/${binaryName}\n`;
    const checksumSignature = await sign(badChecksum);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.endsWith(".sha256.sig")) return new Response(checksumSignature);
        if (path.endsWith(".sha256")) return new Response(badChecksum);
        if (path.endsWith(".gz")) return new Response(gzipSync(bytes));
        return new Response("missing", { status: 404 });
      },
    });
    const installDirectory = await mkdtemp(join(tmpdir(), "naps-cli-install-"));
    temporaryDirectories.push(installDirectory);
    const installedBinary = join(installDirectory, "naps-cli");
    await writeFile(installedBinary, "previous binary");

    try {
      const proc = Bun.spawn(["sh", testInstaller], {
        env: {
          ...process.env,
          NAPS_CLI_BASE: `http://127.0.0.1:${server.port}`,
          NAPS_CLI_VERSION: "v0.4.0",
          NAPS_CLI_INSTALL_DIR: installDirectory,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("checksum mismatch");
      expect(await readFile(installedBinary, "utf8")).toBe("previous binary");
    } finally {
      server.stop(true);
    }
  });
});
