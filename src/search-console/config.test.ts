import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCredentials, readConfig, resolveCredentials, saveCredentials } from "./config";
import type { SearchConsoleCredentials } from "./types";

const temporaryDirectories: string[] = [];

const temporaryConfig = async () => {
  const directory = await mkdtemp(join(tmpdir(), "naps-gsc-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "config.json");
};

const credentials: SearchConsoleCredentials = {
  refreshToken: "refresh-token",
  accessToken: "access-token",
  accessTokenExpiresAt: "2026-08-04T12:00:00.000Z",
  scope: ["scope"],
  connectedAt: "2026-08-04T11:00:00.000Z",
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Search Console config", () => {
  test("writes and clears credentials", async () => {
    const path = await temporaryConfig();
    await saveCredentials({ credentials, path });
    expect((await readConfig({ path })).searchConsole).toEqual(credentials);
    expect(await readFile(path, "utf8")).toEndWith("\n");

    await clearCredentials({ path });
    expect((await readConfig({ path })).searchConsole).toBeUndefined();
  });

  test("uses user-only Unix permissions", async () => {
    if (process.platform === "win32") return;
    const path = await temporaryConfig();
    await saveCredentials({ credentials, path });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("prefers the environment refresh token", async () => {
    const path = await temporaryConfig();
    await saveCredentials({ credentials, path });
    const resolved = await resolveCredentials({
      path,
      env: { NAPS_GSC_REFRESH_TOKEN: "environment-token" },
    });
    expect(resolved?.source).toBe("environment");
    expect(resolved?.credentials.refreshToken).toBe("environment-token");
  });
});
