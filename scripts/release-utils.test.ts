import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBinaryUploadPlan, parseTemporaryCredentials } from "./release-utils";

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "naps-release-"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "naps-cli-test"), "raw");
  await writeFile(join(directory, "naps-cli-test.gz"), "gz");
  await writeFile(join(directory, "naps-cli-test.sha256"), "hash");
  return directory;
};

describe("release upload plan", () => {
  test("later releases upload only immutable gzip and checksum files", async () => {
    const distDir = await fixture();
    const plan = buildBinaryUploadPlan({
      version: "v0.4.1",
      binaries: ["naps-cli-test"],
      distDir,
    });
    expect(plan.map(({ key }) => key)).toEqual([
      "cli/v0.4.1/naps-cli-test.gz",
      "cli/v0.4.1/naps-cli-test.sha256",
    ]);
  });
});

describe("cf output parsing", () => {
  test("parses credentials without exposing their values in errors", () => {
    expect(
      parseTemporaryCredentials({
        output: JSON.stringify({
          accessKeyId: "access",
          secretAccessKey: "secret",
          sessionToken: "token",
        }),
      }),
    ).toEqual({ accessKeyId: "access", secretAccessKey: "secret", sessionToken: "token" });
    try {
      parseTemporaryCredentials({ output: '{"secretAccessKey":"do-not-print"}' });
      throw new Error("Expected invalid credentials to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("cf temporary credentials response is invalid");
      expect((error as Error).message).not.toContain("do-not-print");
    }
  });
});
