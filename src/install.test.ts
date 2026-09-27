import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("POSIX installer", () => {
  test.each(["gzip", "raw"] as const)("installs from the %s artifact", async (mode) => {
    const bytes = new TextEncoder().encode("#!/bin/sh\necho v0.4.0\n");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === `/${mode}/versions.json`) {
          return Response.json({ latest: "v0.4.0", versions: ["v0.4.0"] });
        }
        if (path.endsWith(".sha256")) return new Response(`${checksum}  naps-cli-test\n`);
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
      const proc = Bun.spawn(["sh", join(import.meta.dir, "../install.sh")], {
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
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.endsWith(".sha256")) {
          return new Response(`${"0".repeat(64)}  naps-cli-test\n`);
        }
        if (path.endsWith(".gz")) return new Response(gzipSync(bytes));
        return new Response("missing", { status: 404 });
      },
    });
    const installDirectory = await mkdtemp(join(tmpdir(), "naps-cli-install-"));
    temporaryDirectories.push(installDirectory);
    const installedBinary = join(installDirectory, "naps-cli");
    await writeFile(installedBinary, "previous binary");

    try {
      const proc = Bun.spawn(["sh", join(import.meta.dir, "../install.sh")], {
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
