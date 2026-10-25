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
const originalFetch = globalThis.fetch;
const credentialNames = [
  "NAPS_CLI_API_KEY",
  "NAPS_CLI_REDDIT_API_TOKEN",
  "NAPS_CLI_SEO_API_TOKEN",
  "SEO_API_TOKEN",
  "NAPS_CLI_TWITTERAPI_TOKEN",
  "TWITTERAPI_API_KEY",
  "NAPS_CLI_X_BEARER_TOKEN",
  "NAPS_CLI_TREG_TOKEN",
  "NAPS_CLI_TREG_ORG",
  "TREG_TOKEN",
  "TREG_ORG",
  "X_BEARER_TOKEN",
  "NAPS_GSC_CLIENT_SECRET",
  "NAPS_GSC_REFRESH_TOKEN",
];
const originalCredentials = new Map(credentialNames.map((name) => [name, process.env[name]]));

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
  globalThis.fetch = originalFetch;
  for (const [name, value] of originalCredentials) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI application", () => {
  test("agent guidance is discoverable, offline, credential-independent, and never leaks secrets", async () => {
    let globalRequests = 0;
    let contextRequests = 0;
    globalThis.fetch = (async () => {
      globalRequests += 1;
      throw new Error("offline");
    }) as unknown as typeof fetch;
    let guideOutput: string | undefined;
    for (const withCredentials of [false, true]) {
      const env: Record<string, string> = {};
      for (const name of credentialNames) {
        delete process.env[name];
        if (withCredentials) process.env[name] = env[name] = `synthetic-secret-${name}`;
      }
      const output = createTestContext({ env });
      output.context.fetch = (async () => {
        contextRequests += 1;
        throw new Error("offline");
      }) as unknown as typeof fetch;
      await run(app, ["agent-guide"], {
        ...output.context,
        os: {
          homedir: () => {
            throw new Error("must not load credential files");
          },
        },
      } as unknown as TestContext);

      expect(output.context.process.exitCode).toBe(0);
      expect(output.stderr()).toBe("");
      expect(output.stdout()).not.toContain("synthetic-secret-");
      if (guideOutput !== undefined) expect(output.stdout()).toBe(guideOutput);
      guideOutput = output.stdout();
      const guide = JSON.parse(output.stdout());
      expect(guide.guideUrl).toBe("https://naps.sh/cli/agent.md");
      expect(guide.canonicalGuide).toBe("docs/agents.md");
      expect(guide.instructions.join("\n")).toContain("error.code and error.hint");
      expect(guide.instructions.join("\n")).toContain("operator reconciliation");
    }

    for (const args of [["--help"], ["agent-guide", "--help"]]) {
      const help = createTestContext({ env: {} });
      await run(app, args, help.context);
      expect(help.context.process.exitCode).toBe(0);
      expect(help.stderr()).toBe("");
      expect(help.stdout()).toContain("agent-guide");
      expect(help.stdout()).toContain("offline");
      expect(help.stdout()).not.toContain("synthetic-secret-");
    }
    expect(globalRequests).toBe(0);
    expect(contextRequests).toBe(0);
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
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      throw new Error("must not fetch");
    }) as unknown as typeof fetch;
    const context = createTestContext();
    await run(app, ["twitter-search", "query", "--limit", "101"], context.context);

    expect(context.context.process.exitCode).not.toBe(0);
    expect(context.stdout()).toBe("");
    expect(JSON.parse(context.stderr())).toMatchObject({
      error: { code: "INVALID_ARGUMENTS" },
    });
    expect(requests).toBe(0);
  });

  test("Twitter search preserves provider ordering, paginates, and normalizes both providers", async () => {
    process.env.NAPS_CLI_TWITTERAPI_TOKEN = "synthetic-twitter-secret";
    process.env.NAPS_CLI_X_BEARER_TOKEN = "synthetic-x-secret";
    const query = 'from:operator "exact phrase" -is:retweet';
    for (const provider of ["twitterapi", "official"]) {
      for (const sort of ["latest", "top"]) {
        const urls: URL[] = [];
        globalThis.fetch = (async (input: URL, init?: RequestInit) => {
          const url = new URL(String(input));
          urls.push(url);
          expect(url.searchParams.get("query")).toBe(query);
          const headers = new Headers(init?.headers);
          if (provider === "twitterapi") {
            expect(url.origin + url.pathname).toBe(
              "https://api.twitterapi.io/twitter/tweet/advanced_search",
            );
            expect(headers.get("x-api-key")).toBe("synthetic-twitter-secret");
            expect(headers.has("Authorization")).toBe(false);
            expect(url.searchParams.get("queryType")).toBe(sort === "latest" ? "Latest" : "Top");
            expect(url.searchParams.get("cursor")).toBe(urls.length === 1 ? null : "cursor-2");
            return Response.json(
              urls.length === 1
                ? {
                    tweets: [
                      {
                        id: "9",
                        text: "first",
                        createdAt: "2026-07-01T12:00:00Z",
                        lang: "en",
                        author: {
                          id: "author-9",
                          userName: "operator",
                          name: "Operator",
                          isBlueVerified: false,
                          followers: 17,
                        },
                        replyCount: 1,
                        retweetCount: 2,
                        likeCount: 3,
                        quoteCount: 4,
                        viewCount: 5,
                        bookmarkCount: 6,
                        isReply: true,
                        conversationId: "conversation-9",
                      },
                    ],
                    has_next_page: true,
                    next_cursor: "cursor-2",
                  }
                : {
                    tweets: [
                      { id: "2", text: "second" },
                      { id: "7", text: "third" },
                      { id: "5", text: "over limit" },
                    ],
                    has_next_page: true,
                    next_cursor: "cursor-3",
                  },
            );
          }
          expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets/search/all");
          expect(headers.get("Authorization")).toBe("Bearer synthetic-x-secret");
          expect(headers.has("x-api-key")).toBe(false);
          expect(url.searchParams.get("sort_order")).toBe(
            sort === "latest" ? "recency" : "relevancy",
          );
          expect(url.searchParams.get("max_results")).toBe("10");
          expect(url.searchParams.get("expansions")).toBe("author_id");
          expect(url.searchParams.get("start_time")).toBe("2026-07-01T00:00:00Z");
          expect(url.searchParams.get("end_time")).toBe("2026-07-02T00:00:00Z");
          expect(url.searchParams.get("since_id")).toBe("1");
          expect(url.searchParams.get("until_id")).toBe("99");
          expect(url.searchParams.get("next_token")).toBe(urls.length === 1 ? null : "cursor-2");
          return Response.json(
            urls.length === 1
              ? {
                  data: [
                    {
                      id: "9",
                      text: "first",
                      author_id: "author-9",
                      created_at: "2026-07-01T12:00:00.000Z",
                      lang: "en",
                      in_reply_to_user_id: "reply-user",
                      conversation_id: "conversation-9",
                      public_metrics: {
                        reply_count: 1,
                        retweet_count: 2,
                        like_count: 3,
                        quote_count: 4,
                        impression_count: 5,
                        view_count: 500,
                        bookmark_count: 6,
                      },
                    },
                  ],
                  includes: {
                    users: [
                      { id: "unrelated", username: "wrong" },
                      {
                        id: "author-9",
                        username: "operator",
                        name: "Operator",
                        verified: false,
                        public_metrics: { followers_count: 17 },
                      },
                    ],
                  },
                  meta: { next_token: "cursor-2" },
                }
              : {
                  data: [
                    { id: "2", text: "second" },
                    { id: "7", text: "third" },
                    { id: "5", text: "over limit" },
                  ],
                  meta: { next_token: "cursor-3" },
                },
          );
        }) as unknown as typeof fetch;
        const output = createTestContext();
        await run(
          app,
          [
            "twitter-search",
            query,
            "--provider",
            provider,
            "--limit",
            "3",
            "--sort",
            sort,
            ...(provider === "official"
              ? [
                  "--archive",
                  "all",
                  "--start-time",
                  "2026-07-01T00:00:00Z",
                  "--end-time",
                  "2026-07-02T00:00:00Z",
                  "--since-id",
                  "1",
                  "--until-id",
                  "99",
                ]
              : []),
          ],
          output.context,
        );
        expect(output.context.process.exitCode).toBe(0);
        expect(output.stderr()).toBe("");
        const tweets = JSON.parse(output.stdout());
        expect(tweets.map((tweet: { id: string }) => tweet.id)).toEqual(["9", "2", "7"]);
        expect(tweets[0]).toEqual({
          id: "9",
          url: "https://x.com/operator/status/9",
          text: "first",
          createdAt: "2026-07-01T12:00:00.000Z",
          lang: "en",
          provider,
          author: {
            id: "author-9",
            username: "operator",
            name: "Operator",
            url: "https://x.com/operator",
            verified: false,
            followers: 17,
          },
          metrics: { replies: 1, retweets: 2, likes: 3, quotes: 4, views: 5, bookmarks: 6 },
          isReply: true,
          conversationId: "conversation-9",
        });
        expect(tweets[1]).toEqual({
          id: "2",
          url: "https://x.com/i/web/status/2",
          text: "second",
          createdAt: null,
          lang: null,
          provider,
          author: {
            id: null,
            username: null,
            name: null,
            url: null,
            verified: null,
            followers: null,
          },
          metrics: {
            replies: null,
            retweets: null,
            likes: null,
            quotes: null,
            views: null,
            bookmarks: null,
          },
          isReply: provider === "official" ? false : null,
          conversationId: null,
        });
        expect(urls).toHaveLength(2);
        expect(output.stdout()).not.toContain("synthetic-twitter-secret");
        expect(output.stdout()).not.toContain("synthetic-x-secret");
      }
    }
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
