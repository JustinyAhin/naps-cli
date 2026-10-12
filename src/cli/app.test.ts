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
  test("agent guidance is discoverable and returns concise JSON without credentials", async () => {
    const output = createTestContext({ env: {} });
    await run(app, ["agent-guide"], output.context);

    expect(output.context.process.exitCode).toBe(0);
    expect(output.stderr()).toBe("");
    const guide = JSON.parse(output.stdout());
    expect(guide.guideUrl).toBe("https://naps.sh/cli/agent.md");
    expect(guide.canonicalGuide).toBe("docs/agents.md");
    expect(guide.instructions.join("\n")).toContain("error.code and error.hint");
    expect(guide.instructions.join("\n")).toContain("operator reconciliation");
    expect(guide.examples).toContain("naps-cli keywords 'invoice software' --refresh --metadata");

    for (const args of [["--help"], ["agent-guide", "--help"]]) {
      const help = createTestContext({ env: {} });
      await run(app, args, help.context);
      expect(help.context.process.exitCode).toBe(0);
      expect(help.stderr()).toBe("");
      expect(help.stdout()).toContain("agent-guide");
      expect(help.stdout()).toContain("offline");
    }
  });

  test("keyword help documents value placeholders and bulk-only resume IDs", async () => {
    for (const command of ["keywords", "keywords-bulk", "keywords-serp", "keywords-website"]) {
      const output = createTestContext();
      await run(app, [command, "--help"], output.context);

      expect(output.context.process.exitCode).toBe(0);
      expect(output.stderr()).toBe("");
      expect(output.stdout()).toMatch(/\[--budget\]\s+<USD>/);
      expect(output.stdout()).toContain("--refresh");
      expect(output.stdout()).toContain("--metadata");
      if (command === "keywords-bulk") {
        expect(output.stdout()).toMatch(/\[--request-id\]\s+<value>/);
      } else {
        expect(output.stdout()).not.toContain("--request-id");
      }
    }
  });

  test("rejects excessive Twitter requests with a structured argument error", async () => {
    const context = createTestContext();
    await run(app, ["twitter-search", "query", "--limit", "101"], context.context);

    expect(context.context.process.exitCode).not.toBe(0);
    expect(context.stdout()).toBe("");
    expect(JSON.parse(context.stderr())).toMatchObject({
      error: { code: "INVALID_ARGUMENTS" },
    });
  });

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
