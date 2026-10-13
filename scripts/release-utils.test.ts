import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCfAuthenticated,
  buildBinaryUploadPlan,
  parseAccountId,
  parseCfVersion,
  parseTemporaryCredentials,
  resolveCfAccountId,
} from "./release-utils";

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "naps-release-"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "naps-cli-test"), "raw");
  await writeFile(join(directory, "naps-cli-test.gz"), "gz");
  await writeFile(join(directory, "naps-cli-test.sha256"), "hash");
  await writeFile(join(directory, "naps-cli-test.sha256.sig"), "signature");
  return directory;
};

describe("release upload plan", () => {
  test("later releases upload immutable gzip, checksum, and signature files", async () => {
    const distDir = await fixture();
    const plan = buildBinaryUploadPlan({
      version: "v0.4.1",
      binaries: ["naps-cli-test"],
      distDir,
    });
    expect(plan.map(({ key }) => key)).toEqual([
      "cli/v0.4.1/naps-cli-test.gz",
      "cli/v0.4.1/naps-cli-test.sha256",
      "cli/v0.4.1/naps-cli-test.sha256.sig",
    ]);
  });
});

describe("cf release account selection", () => {
  test("bucket-scoped API tokens do not require user-profile access", async () => {
    const accountId = "a".repeat(32);
    const getWhoami = mock(async () => JSON.stringify({ authenticated: true, tokenValid: false }));
    expect(
      await resolveCfAccountId({ hasApiToken: true, accountId: ` ${accountId} `, getWhoami }),
    ).toBe(accountId);
    expect(getWhoami).not.toHaveBeenCalled();
  });

  test("API-token mode requires a valid explicit account without querying whoami", async () => {
    const getWhoami = mock(async () => JSON.stringify({ accounts: [{ id: "a".repeat(32) }] }));
    for (const accountId of [undefined, "", " "]) {
      await expect(resolveCfAccountId({ hasApiToken: true, accountId, getWhoami })).rejects.toThrow(
        "CLOUDFLARE_ACCOUNT_ID is required with CLOUDFLARE_API_TOKEN",
      );
    }
    await expect(
      resolveCfAccountId({ hasApiToken: true, accountId: "PRIVATE_INVALID_ID", getWhoami }),
    ).rejects.toThrow("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID.");
    expect(getWhoami).not.toHaveBeenCalled();
  });

  test("OAuth still checks authentication before selecting an account", async () => {
    const accountId = "a".repeat(32);
    const getWhoami = mock(async () =>
      JSON.stringify({ authenticated: true, tokenValid: true, accounts: [{ id: accountId }] }),
    );
    expect(await resolveCfAccountId({ hasApiToken: false, getWhoami })).toBe(accountId);
    expect(getWhoami).toHaveBeenCalledTimes(1);
    for (const payload of [{ authenticated: false }, { authenticated: true, tokenValid: false }]) {
      await expect(
        resolveCfAccountId({
          hasApiToken: false,
          accountId,
          getWhoami: async () => JSON.stringify(payload),
        }),
      ).rejects.toThrow("cf is not authenticated with a valid token");
    }
  });
});

describe("cf output parsing", () => {
  test("selects an explicit or sole authenticated account without guessing or leaking responses", () => {
    const first = "a".repeat(32);
    const second = "b".repeat(32);
    const output = JSON.stringify({
      authenticated: true,
      tokenValid: true,
      accounts: [{ id: first }, { id: second }],
    });
    expect(parseCfVersion({ output: "1.0.0-beta.14" })).toEqual([1, 0, 0]);
    expect(() => assertCfAuthenticated({ output })).not.toThrow();
    expect(parseAccountId({ output, accountId: ` ${second} ` })).toBe(second);
    expect(parseAccountId({ output: JSON.stringify({ accounts: [{ id: first }] }) })).toBe(first);
    for (const accounts of [[], [{ id: first }, { id: second }]]) {
      expect(() => parseAccountId({ output: JSON.stringify({ accounts }) })).toThrow(
        "Set CLOUDFLARE_ACCOUNT_ID",
      );
    }
    for (const payload of [
      {},
      { authenticated: false },
      { authenticated: true, tokenValid: false },
    ]) {
      expect(() => assertCfAuthenticated({ output: JSON.stringify(payload) })).toThrow(
        "not authenticated",
      );
    }
    for (const input of [
      { output: "PRIVATE_INVALID_JSON" },
      { output: JSON.stringify({ accounts: [{ id: "PRIVATE_INVALID_ID" }] }) },
      { output, accountId: "PRIVATE_INVALID_ID" },
    ]) {
      try {
        parseAccountId(input);
        throw new Error("Expected invalid account selection to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain("PRIVATE_");
        expect((error as Error).message).not.toBe("Expected invalid account selection to fail.");
      }
    }
  });

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
