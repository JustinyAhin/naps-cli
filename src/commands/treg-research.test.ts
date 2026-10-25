import { describe, expect, test } from "bun:test";
import { run } from "@stricli/core";
import { app } from "../cli/app";
import { createContext } from "../cli/context";
import type { CliContext } from "../cli/context";

type TestContext = CliContext & {
  process: CliContext["process"] & { exitCode?: number | string | null };
};

const personUrl = "https://www.linkedin.com/in/alex-example";
const postUrl = "https://www.linkedin.com/posts/alex-example_activity-1234567890123456789-abcd";
const companyUrl = "https://www.linkedin.com/company/example";
const channelId = "UC-9-kyTW8ZkZNDHQJ6FgpwQ";

// Shapes follow Treg's captured HarvestAPI and ScrapeCreators examples.
// All identities, text, pagination tokens, and credentials here are synthetic.
const post = {
  id: "1234567890123456789",
  linkedinUrl: postUrl,
  content: "We compare supplier quotes in a spreadsheet.",
  author: {
    name: "Alex Example",
    linkedinUrl: personUrl,
    info: "Purchasing manager",
    type: "profile",
  },
  postedAt: { date: "2026-10-20T12:00:00.000Z" },
  engagement: { likes: 0, comments: 2 },
};
const searchResult = {
  status: 200,
  elements: [post],
  pagination: { pageNumber: 1, totalPages: 2, totalResultCount: 60 },
};
const channel = {
  success: true,
  channelId,
  channel: `https://www.youtube.com/channel/${channelId}`,
  handle: "@YouTube",
  name: "YouTube",
  subscriberCount: 127_000_000,
  videoCount: null,
  viewCount: null,
};
const video = {
  id: "Y8Wu4rSNJms",
  title: "Example video",
  url: "https://www.youtube.com/watch?v=Y8Wu4rSNJms",
  viewCount: 0,
};

const invoke = async ({
  args,
  data = {},
  status = 200,
  headers = {},
  env = { NAPS_CLI_TREG_TOKEN: "synthetic-treg-secret" },
  handler,
}: {
  args: string[];
  data?: unknown;
  status?: number;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  handler?: (request: { url: URL; init: RequestInit }) => Response | Promise<Response>;
}) => {
  let stdout = "";
  let stderr = "";
  const requests: { url: URL; init: RequestInit }[] = [];
  const context = {
    ...createContext(),
    process: {
      env,
      stdout: {
        write: (s: string) => {
          stdout += s;
          return true;
        },
      },
      stderr: {
        write: (s: string) => {
          stderr += s;
          return true;
        },
      },
    },
    fetch: (async (input: URL, init: RequestInit) => {
      const request = { url: new URL(String(input)), init };
      requests.push(request);
      return handler ? handler(request) : Response.json(data, { status, headers });
    }) as unknown as typeof fetch,
  } as unknown as TestContext;
  await run(app, args, context);
  return { stdout, stderr, requests, code: context.process.exitCode };
};

describe("Treg research commands", () => {
  test("all routes have offline help, cost controls, and completion", async () => {
    const names = [
      "linkedin-search",
      "linkedin-post",
      "company-lookup",
      "person-lookup",
      "email-find",
      "email-verify",
      "youtube-channel",
      "youtube-videos",
    ];
    for (const name of names) {
      const output = await invoke({ args: [name, "--help"], env: {} });
      expect(output.code).toBe(0);
      expect(output.stderr).toBe("");
      expect(output.requests).toHaveLength(0);
      expect(output.stdout).toContain("--budget");
      expect(output.stdout).toContain("--metadata");
      expect(output.stdout).toContain("--request-id");
    }
    const completion = await invoke({
      args: ["--complete"],
      env: { COMP_LINE: "naps-cli linkedin-" },
    });
    expect(completion.stdout).toContain("linkedin-search");
    expect(completion.stdout).toContain("linkedin-post");
  });

  test("LinkedIn search preserves evidence, missing metrics, budgets, team selection, and pagination", async () => {
    const output = await invoke({
      args: [
        "linkedin-search",
        '"bid leveling" AND spreadsheet',
        "--sort",
        "date",
        "--time",
        "3months",
        "--page",
        "2",
        "--pagination-token",
        "synthetic-page-token",
        "--author",
        personUrl,
        "--company",
        companyUrl,
        "--budget",
        "0.01",
        "--metadata",
        "--request-id",
        "research-1",
      ],
      env: {
        NAPS_CLI_TREG_TOKEN: "synthetic-treg-secret",
        TREG_TOKEN: "unused-alias",
        NAPS_CLI_TREG_ORG: "example-team",
      },
      headers: { "X-Treg-Cost-Micro": "2000", "X-Treg-Call-Id": "synthetic-call" },
      data: { ...searchResult, paginationToken: "synthetic-next-token" },
    });
    expect(output.code).toBe(0);
    expect(output.requests).toHaveLength(1);
    const request = output.requests[0]!;
    expect(request.url.origin + request.url.pathname).toBe(
      "https://treg.to/call/harvestapi.linkedin.post.search",
    );
    expect(Object.fromEntries(request.url.searchParams)).toEqual({
      search: '"bid leveling" AND spreadsheet',
      sortBy: "date",
      scrapePostedLimit: "3months",
      page: "2",
      paginationToken: "synthetic-page-token",
      profile: personUrl,
      company: companyUrl,
    });
    const headers = new Headers(request.init.headers);
    expect(headers.get("X-Treg-Token")).toBe("synthetic-treg-secret");
    expect(headers.get("X-Treg-Org")).toBe("example-team");
    expect(headers.get("X-Treg-Route-Max-Cost")).toBe("0.01");
    expect(headers.get("Idempotency-Key")).toBe("research-1");
    expect(request.init.method).toBe("GET");
    expect(request.init.redirect).toBe("error");
    expect(request.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(output.stdout)).toMatchObject({
      provider: "treg",
      sourceProvider: "harvestapi",
      requestId: "research-1",
      result: {
        posts: [
          {
            url: postUrl,
            text: post.content,
            publishedAt: "2026-10-20T12:00:00.000Z",
            author: { name: "Alex Example", url: personUrl, headline: "Purchasing manager" },
            metrics: { likes: 0, comments: 2, shares: null },
          },
        ],
        pagination: { nextToken: "synthetic-next-token" },
        fetched: 1,
        truncated: false,
      },
    });
    expect(JSON.parse(output.stderr)).toMatchObject({
      treg: { providerCostUsd: 0.002, callId: "synthetic-call" },
    });
    expect(output.stdout + output.stderr).not.toContain("synthetic-treg-secret");
  });

  test("single-post retrieval strips tracking parameters and preserves null misses", async () => {
    for (const element of [post, null]) {
      const output = await invoke({
        args: ["linkedin-post", postUrl + "?trackingId=example#fragment"],
        data: { element, status: 200 },
      });
      expect(output.code).toBe(0);
      expect(output.requests[0]!.url.searchParams.get("url")).toBe(postUrl);
      expect(JSON.parse(output.stdout).result).toEqual(
        element ? expect.objectContaining({ url: postUrl }) : null,
      );
    }
  });

  test("lookup commands send only the supported identity fields and preserve provider verdicts", async () => {
    const cases = [
      {
        args: ["company-lookup", "EXAMPLE.COM"],
        endpoint: "treg.companies.enrich",
        body: { domain: "example.com" },
      },
      {
        args: ["company-lookup", "https://example.com/about?track=yes"],
        endpoint: "treg.companies.enrich",
        body: { website: "https://example.com/about" },
      },
      {
        args: ["company-lookup", companyUrl],
        endpoint: "treg.companies.enrich",
        body: { linkedin_url: companyUrl },
      },
      {
        args: ["person-lookup", personUrl],
        endpoint: "treg.people.enrich",
        body: { linkedin_url: personUrl },
      },
      {
        args: ["person-lookup", "alex@example.com"],
        endpoint: "treg.people.enrich",
        body: { email: "alex@example.com" },
      },
      {
        args: ["email-find", "--name", "Alex Example", "--domain", "example.com"],
        endpoint: "treg.people.email.find",
        body: { full_name: "Alex Example", domain: "example.com" },
      },
      {
        args: ["email-find", "--linkedin-url", personUrl],
        endpoint: "treg.people.email.find",
        body: { linkedin_url: personUrl },
      },
      {
        args: ["email-verify", "alex@example.com"],
        endpoint: "treg.people.email.verify",
        body: { email: "alex@example.com" },
      },
    ];
    for (const c of cases) {
      const verdict = {
        email: "alex@example.com",
        status: "unknown",
        verified: false,
        confidence: null,
      };
      const output = await invoke({
        args: c.args,
        env: { TREG_TOKEN: "synthetic-alias-secret", TREG_ORG: "alias-team" },
        data: { output: verdict, _treg: { served_by: "example-provider", tried: [] } },
      });
      expect(output.code).toBe(0);
      expect(output.stderr).toBe("");
      expect(output.requests).toHaveLength(1);
      const request = output.requests[0]!;
      expect(request.url.toString()).toBe(`https://treg.to/call/${c.endpoint}`);
      expect(request.init.method).toBe("POST");
      expect(JSON.parse(request.init.body as string)).toEqual(c.body);
      expect(new Headers(request.init.headers).get("X-Treg-Route-Max-Cost")).toBe("0.05");
      expect(new Headers(request.init.headers).get("X-Treg-Token")).toBe("synthetic-alias-secret");
      expect(new Headers(request.init.headers).get("X-Treg-Org")).toBe("alias-team");
      expect(JSON.parse(output.stdout)).toMatchObject({
        sourceProvider: "example-provider",
        result: verdict,
      });
    }
    const miss = await invoke({ args: ["company-lookup", "example.com"], data: { output: null } });
    expect(miss.code).toBe(0);
    expect(JSON.parse(miss.stdout).result).toBe(null);
  });

  test("YouTube channel statistics accept handles and IDs, without inventing absent counts", async () => {
    for (const input of [
      "@YouTube",
      "YouTube",
      "https://www.youtube.com/@YouTube/videos",
      channelId,
      `https://www.youtube.com/channel/${channelId}`,
    ]) {
      const output = await invoke({ args: ["youtube-channel", input], data: channel });
      expect(output.code).toBe(0);
      expect(output.requests).toHaveLength(1);
      expect(output.requests[0]!.url.pathname).toBe("/call/scrapecreators.youtube.channel.profile");
      expect(Object.fromEntries(output.requests[0]!.url.searchParams)).toEqual(
        input.includes(channelId) ? { channelId } : { handle: "YouTube" },
      );
      expect(JSON.parse(output.stdout).result).toMatchObject({
        id: channelId,
        subscribers: 127_000_000,
        videos: null,
        views: null,
        verified: null,
      });
    }
  });

  test("video lists preserve native rows and cursors and do not fetch another page", async () => {
    const output = await invoke({
      args: [
        "youtube-videos",
        "@YouTube",
        "--sort",
        "popular",
        "--continuation-token",
        "synthetic-cursor",
        "--limit",
        "1",
      ],
      data: {
        success: true,
        videos: [video, { ...video, id: "different" }],
        continuationToken: "next-cursor",
      },
    });
    expect(output.code).toBe(0);
    expect(output.requests).toHaveLength(1);
    expect(Object.fromEntries(output.requests[0]!.url.searchParams)).toEqual({
      handle: "YouTube",
      sort: "popular",
      continuationToken: "synthetic-cursor",
    });
    expect(JSON.parse(output.stdout).result).toEqual({
      videos: [video],
      continuationToken: "next-cursor",
      fetched: 2,
      truncated: true,
    });
    const empty = await invoke({ args: ["youtube-videos", channelId], data: { videos: [] } });
    expect(empty.code).toBe(0);
    expect(JSON.parse(empty.stdout).result.videos).toEqual([]);
  });

  test("search truncation and empty results remain explicit", async () => {
    const output = await invoke({
      args: ["linkedin-search", "quotes", "--limit", "1"],
      data: { ...searchResult, elements: [post, post] },
    });
    expect(JSON.parse(output.stdout).result).toMatchObject({ fetched: 2, truncated: true });
    expect(JSON.parse(output.stdout).result.posts).toHaveLength(1);
    const empty = await invoke({ args: ["linkedin-search", "quotes"], data: { elements: [] } });
    expect(empty.code).toBe(0);
    expect(JSON.parse(empty.stdout).result.posts).toEqual([]);
  });

  test("invalid inputs cannot start paid calls", async () => {
    const cases = [
      ["linkedin-search", "   "],
      ["linkedin-search", "quotes", "--budget", "NaN"],
      ["linkedin-search", "quotes", "--budget", "-1"],
      ["linkedin-search", "quotes", "--page", "0"],
      ["youtube-videos", "@YouTube", "--limit", "101"],
      ["linkedin-post", "https://linkedin.com.evil.example/posts/example"],
      ["linkedin-post", "http://www.linkedin.com/posts/example"],
      ["linkedin-post", "https://secret@www.linkedin.com/posts/example"],
      ["linkedin-post", "https://www.linkedin.com/in/example"],
      ["company-lookup", "localhost"],
      ["company-lookup", "https://127.0.0.1/private"],
      ["person-lookup", "not-an-email"],
      ["email-find"],
      ["email-find", "--name", "Alex"],
      ["email-find", "--name", "Alex", "--domain", "example.com", "--linkedin-url", personUrl],
      ["email-verify", "alex"],
      ["youtube-channel", "https://youtube.com.evil.example/@YouTube"],
      ["youtube-videos", "https://www.youtube.com/watch?v=Y8Wu4rSNJms"],
      ["company-lookup", "example.com", "--request-id", "bad\nheader"],
    ];
    for (const args of cases) {
      const output = await invoke({ args });
      expect(output.code, args.join(" ")).not.toBe(0);
      expect(output.stdout).toBe("");
      expect(JSON.parse(output.stderr).error.code).toBe("INVALID_ARGUMENTS");
      expect(output.requests).toHaveLength(0);
    }
  });

  test("missing credentials are actionable and need no network", async () => {
    const output = await invoke({ args: ["linkedin-search", "quotes"], env: {} });
    expect(output.code).not.toBe(0);
    expect(output.stdout).toBe("");
    expect(output.requests).toHaveLength(0);
    expect(JSON.parse(output.stderr).error).toMatchObject({
      code: "MISSING_TREG_TOKEN",
      hint: expect.stringContaining("NAPS_CLI_TREG_TOKEN"),
    });
  });

  test("cost metadata distinguishes explicit zero from absent or invalid costs", async () => {
    for (const [header, expected] of [
      [undefined, null],
      ["0", 0],
      ["4000", 0.004],
      ["invalid", null],
      ["9007199254740992", null],
    ] as const) {
      const output = await invoke({
        args: ["company-lookup", "example.com", "--budget", "0", "--metadata"],
        data: { output: null },
        headers: header === undefined ? {} : { "X-Treg-Cost-Micro": header },
      });
      expect(output.code).toBe(0);
      expect(JSON.parse(output.stderr).treg.providerCostUsd).toBe(expected);
      expect(new Headers(output.requests[0]!.init.headers).get("X-Treg-Route-Max-Cost")).toBe("0");
    }
  });

  test("HTTP errors retain billed cost but never relay provider secrets or account links", async () => {
    for (const [status, code] of [
      [401, "TREG_ACCESS_DENIED"],
      [403, "TREG_ACCESS_DENIED"],
      [402, "TREG_PAYMENT_REQUIRED"],
      [429, "TREG_RATE_LIMITED"],
      [503, "TREG_UNAVAILABLE"],
      [422, "TREG_REQUEST_REJECTED"],
    ] as const) {
      const output = await invoke({
        args: ["company-lookup", "example.com", "--metadata"],
        status,
        data: {
          error: "synthetic-treg-secret",
          balance: 999,
          top_up: "https://example.com/private-account",
        },
        headers: { "X-Treg-Cost-Micro": "2000" },
      });
      expect(output.code).not.toBe(0);
      expect(output.stdout).toBe("");
      expect(output.requests).toHaveLength(1);
      expect(JSON.parse(output.stderr)).toMatchObject({
        error: { code, details: { treg: { providerCostUsd: 0.002 } } },
      });
      expect(output.stderr).not.toContain("synthetic-treg-secret");
      expect(output.stderr).not.toContain("private-account");
    }
    const budget = await invoke({
      args: ["company-lookup", "example.com"],
      status: 402,
      headers: { "X-Treg-Error": "1" },
      data: { error: "route_max_cost" },
    });
    expect(JSON.parse(budget.stderr).error.code).toBe("TREG_BUDGET_EXCEEDED");
  });

  test("HTTP 200 failures, pending jobs, and malformed bodies cannot become research evidence", async () => {
    for (const data of [
      { success: false },
      { status: 503 },
      { error: "synthetic-treg-secret" },
      { status: "failed" },
    ]) {
      const output = await invoke({ args: ["linkedin-search", "quotes"], data });
      expect(output.code).not.toBe(0);
      expect(output.stdout).toBe("");
      expect(JSON.parse(output.stderr).error.code).toBe("TREG_PROVIDER_ERROR");
      expect(output.stderr).not.toContain("synthetic-treg-secret");
    }
    for (const [args, data] of [
      [["linkedin-search", "quotes"], { elements: [null] }],
      [["company-lookup", "example.com"], {}],
      [["youtube-channel", "@YouTube"], {}],
      [["youtube-videos", "@YouTube"], { videos: "invalid" }],
    ] as const) {
      const output = await invoke({ args: [...args], data });
      expect(output.code).not.toBe(0);
      expect(JSON.parse(output.stderr).error.code).toBe("TREG_INVALID_RESPONSE");
    }
    const pending = await invoke({
      args: ["company-lookup", "example.com"],
      status: 202,
      data: { job_id: "synthetic" },
    });
    expect(JSON.parse(pending.stderr).error.code).toBe("TREG_PENDING");
    const malformed = await invoke({
      args: ["company-lookup", "example.com"],
      handler: () => new Response("not JSON"),
    });
    expect(JSON.parse(malformed.stderr).error.code).toBe("TREG_INVALID_RESPONSE");
  });

  test("network failures never retry and preserve the replay ID without leaking error text", async () => {
    const output = await invoke({
      args: ["company-lookup", "example.com", "--request-id", "retry-this-id"],
      handler: () => {
        throw new Error("synthetic-treg-secret");
      },
    });
    expect(output.requests).toHaveLength(1);
    expect(output.code).not.toBe(0);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toMatchObject({
      error: {
        code: "TREG_OUTCOME_UNKNOWN",
        details: { treg: { requestId: "retry-this-id", providerCostUsd: null } },
      },
    });
    expect(output.stderr).not.toContain("synthetic-treg-secret");
  });
});
