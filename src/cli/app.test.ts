import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "@stricli/core";
import { app } from "./app";
import type { CliContext } from "./context";

type TestContext = CliContext & {
  process: CliContext["process"] & { exitCode?: number | string | null };
};

const temporaryDirectories: string[] = [];

const createTestContext = ({
  home,
  env = { SHELL: "/bin/bash" },
}: { home?: string; env?: Record<string, string> } = {}) => {
  let stdout = "";
  let stderr = "";
  const context = {
    process: {
      env,
      stdout: {
        write: (value: string) => {
          stdout += value;
          return true;
        },
      },
      stderr: {
        write: (value: string) => {
          stderr += value;
          return true;
        },
      },
    },
    fetch,
    fs,
    os: { homedir: () => home ?? os.homedir() },
    path,
    runtime: {
      executablePath: process.execPath,
      platform: process.platform,
      architecture: process.arch,
    },
  } as unknown as TestContext;
  return { context, stdout: () => stdout, stderr: () => stderr };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI application", () => {
  test("formats command runtime errors as structured JSON", async () => {
    const invalidUrl = createTestContext();
    await run(app, ["reddit-post", "not-a-url"], invalidUrl.context);

    expect(invalidUrl.context.process.exitCode).not.toBe(0);
    expect(invalidUrl.stdout()).toBe("");
    expect(JSON.parse(invalidUrl.stderr())).toEqual({
      error: {
        code: "INVALID_REDDIT_URL",
        message: "Enter a full Reddit post URL.",
        hint: "Use a URL such as https://www.reddit.com/r/example/comments/post-id/title/.",
      },
    });
  });

  test("installs and uninstalls Bash completion explicitly", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "naps-cli-completion-"));
    temporaryDirectories.push(home);
    const bashrc = path.join(home, ".bashrc");
    fs.writeFileSync(bashrc, "# existing\n");

    const install = createTestContext({ home });
    await run(app, ["completion", "install"], install.context);
    expect(install.context.process.exitCode).toBe(0);
    expect(fs.readFileSync(bashrc, "utf8")).toContain("naps-cli --complete");

    const uninstall = createTestContext({ home });
    await run(app, ["completion", "uninstall"], uninstall.context);
    expect(uninstall.context.process.exitCode).toBe(0);
    expect(fs.readFileSync(bashrc, "utf8")).toBe("# existing\n");
  });
});
