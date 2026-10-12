import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withReleaseSigningKey } from "./release-key";

let fixtureDirectory = "";
let fixtureKeyPath = "";
let fixtureKeyContent = "";

const runKeygen = async ({ args, stdin }: { args: string[]; stdin?: string }) => {
  const process = Bun.spawn(["ssh-keygen", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, output] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error("Synthetic ssh-keygen check failed.");
  return output.trim();
};

const expectRemoved = async ({ path }: { path: string }) => {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
};

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "naps-release-key-check-"));
  fixtureKeyPath = join(fixtureDirectory, "generated-test-key");
  await runKeygen({ args: ["-q", "-t", "ed25519", "-N", "", "-f", fixtureKeyPath] });
  // This key is created by the test. It never reads a maintainer's signing key.
  fixtureKeyContent = await readFile(fixtureKeyPath, "utf8");
});

afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("release signing key", () => {
  test("keeps an existing file path and leaves its file intact", async () => {
    const result = await withReleaseSigningKey({
      keyPath: fixtureKeyPath,
      run: async ({ signingKeyPath }) => {
        expect(signingKeyPath).toBe(fixtureKeyPath);
        return runKeygen({ args: ["-y", "-f", signingKeyPath] });
      },
    });
    expect(result.startsWith("ssh-ed25519 ")).toBe(true);
    await access(fixtureKeyPath);
  });

  test("materializes a private key with restrictive modes and signs a verifiable file", async () => {
    let temporaryKeyPath = "";
    const messagePath = join(fixtureDirectory, "message");
    const message = "Synthetic release checksum\n";
    await writeFile(messagePath, message);
    const allowedSigners = join(fixtureDirectory, "allowed-signers");
    const publicKey = await readFile(`${fixtureKeyPath}.pub`, "utf8");
    await writeFile(allowedSigners, `release-check ${publicKey.trim()}\n`);

    const result = await withReleaseSigningKey({
      keyContent: fixtureKeyContent.replaceAll("\n", "\r\n").trimEnd(),
      run: async ({ signingKeyPath }) => {
        temporaryKeyPath = signingKeyPath;
        expect((await stat(dirname(signingKeyPath))).mode & 0o777).toBe(0o700);
        expect((await stat(signingKeyPath)).mode & 0o777).toBe(0o600);
        await runKeygen({
          args: ["-Y", "sign", "-q", "-f", signingKeyPath, "-n", "release-key-check", messagePath],
        });
        return runKeygen({
          args: [
            "-Y",
            "verify",
            "-f",
            allowedSigners,
            "-I",
            "release-check",
            "-n",
            "release-key-check",
            "-s",
            `${messagePath}.sig`,
          ],
          stdin: message,
        });
      },
    });

    expect(result).toContain("Good");
    await expectRemoved({ path: temporaryKeyPath });
    await expectRemoved({ path: dirname(temporaryKeyPath) });
  });

  test("removes the temporary key after a release operation fails", async () => {
    let temporaryKeyPath = "";
    const failure = new Error("Synthetic release operation failed.");
    await expect(
      withReleaseSigningKey({
        keyContent: fixtureKeyContent,
        run: async ({ signingKeyPath }) => {
          temporaryKeyPath = signingKeyPath;
          await access(signingKeyPath);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    await expectRemoved({ path: dirname(temporaryKeyPath) });
  });

  test("rejects missing or ambiguous sources before running release operations", async () => {
    let called = false;
    const run = async () => {
      called = true;
    };
    await expect(withReleaseSigningKey({ run })).rejects.toThrow("is required");
    await expect(withReleaseSigningKey({ keyPath: " ", keyContent: "\n", run })).rejects.toThrow(
      "is required",
    );
    await expect(
      withReleaseSigningKey({ keyPath: fixtureKeyPath, keyContent: fixtureKeyContent, run }),
    ).rejects.toThrow("Set only one");
    expect(called).toBe(false);
  });

  test("rejects malformed content without including it in errors", async () => {
    const invalidContent = "INVALID_PRIVATE_KEY_CHECK_VALUE";
    try {
      await withReleaseSigningKey({
        keyContent: invalidContent,
        run: async () => {
          throw new Error("Release operation must not run.");
        },
      });
      throw new Error("Expected malformed content to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("complete OpenSSH private key");
      expect((error as Error).message).not.toContain(invalidContent);
    }
  });

  test("cleans up when ssh-keygen rejects a syntactically wrapped invalid key", async () => {
    let temporaryKeyPath = "";
    await expect(
      withReleaseSigningKey({
        keyContent:
          "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
        run: async ({ signingKeyPath }) => {
          temporaryKeyPath = signingKeyPath;
          await runKeygen({ args: ["-y", "-f", signingKeyPath] });
        },
      }),
    ).rejects.toThrow("Synthetic ssh-keygen check failed");
    await expectRemoved({ path: dirname(temporaryKeyPath) });
  });
});
