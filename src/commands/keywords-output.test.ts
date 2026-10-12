import { afterEach, expect, test } from "bun:test";
import { run } from "@stricli/core";
import { app } from "../cli/app";
import { createContext } from "../cli/context";
import type { CliContext } from "../cli/context";

const originalFetch = globalThis.fetch;
const originalKey = process.env.NAPS_CLI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NAPS_CLI_API_KEY;
  else process.env.NAPS_CLI_API_KEY = originalKey;
});

const capture = () => {
  let stdout = "";
  let stderr = "";
  const context = {
    ...createContext(),
    process: {
      env: process.env,
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
  } as unknown as CliContext & { process: { exitCode?: number | string | null } };
  process.env.NAPS_CLI_API_KEY = "test-not-a-real-key";
  return { context, stdout: () => stdout, stderr: () => stderr };
};

const keyword = (index: number) => ({
  keyword: `candidate-${index}`,
  volume: index * 7,
  rank: 100 - index,
  cpc: 1.5,
  competition: "LOW",
  mainIntent: "informational",
  difficulty: 12,
});

test("suggestions and website preserve best results beyond the display cutoff", async () => {
  const candidates = Array.from({ length: 100 }, (_, index) => keyword(index));
  globalThis.fetch = (async (request: Request) => {
    const url = new URL(request.url);
    expect(url.searchParams.get("location_name")).toBe("Germany");
    expect(url.searchParams.get("language_name")).toBe("German");
    return Response.json({ keywordSuggestions: candidates, keywords: candidates, cost: 0.024 });
  }) as unknown as typeof fetch;

  for (const [command, count] of [
    ["keywords", 25],
    ["keywords-website", 30],
  ] as const) {
    const output = capture();
    await run(
      app,
      [command, "example", "--location", "Germany", "--language", "German"],
      output.context,
    );
    expect(output.context.process.exitCode).toBe(0);
    expect(output.stderr()).toBe("");
    const results = JSON.parse(output.stdout());
    expect(results).toHaveLength(count);
    expect(results.map((result: { keyword: string }) => result.keyword)).toEqual(
      Array.from({ length: count }, (_, index) => `candidate-${99 - index}`),
    );
    expect(Object.keys(results[0]).sort()).toEqual(
      command === "keywords"
        ? ["competition", "difficulty", "keyword", "mainIntent", "volume"]
        : ["keyword", "mainIntent", "rank", "volume"],
    );
  }
});

test("bulk preserves repeated input, full suggestions, errors, and unknown costs", async () => {
  const data = {
    results: [
      {
        keyword: "first",
        suggestions: Array.from({ length: 100 }, (_, index) => keyword(index)),
        count: 100,
        cost: 0.024,
      },
      { keyword: "failed", suggestions: [], count: 0, cost: null, error: "UPSTREAM_FAILURE" },
      { keyword: "first", suggestions: [keyword(4)], count: 1, cost: 0 },
    ],
    totalKeywords: 3,
  };
  globalThis.fetch = (async (request: Request) => {
    expect(await request.json()).toEqual({ keywords: "first\nfailed\nfirst" });
    return Response.json(data);
  }) as unknown as typeof fetch;
  const output = capture();
  await run(app, ["keywords-bulk", "first", "failed", "first"], output.context);
  expect(output.context.process.exitCode).toBe(0);
  expect(output.stderr()).toBe("");
  expect(JSON.parse(output.stdout())).toEqual(data);
});

test("SERP preserves operators and low-result queries without padding", async () => {
  const page = {
    rank: 3,
    title: "One match",
    domain: "example.com",
    url: "https://example.com/page",
    description: "A short description",
    breadcrumb: "example.com > page",
  };
  globalThis.fetch = (async (request: Request) => {
    expect(new URL(request.url).searchParams.get("keyword")).toBe(
      'site:example.com "exact phrase"',
    );
    return Response.json({ results: [page], keyword: "query", cost: null });
  }) as unknown as typeof fetch;
  const output = capture();
  await run(app, ["keywords-serp", 'site:example.com "exact phrase"'], output.context);
  expect(output.context.process.exitCode).toBe(0);
  expect(output.stderr()).toBe("");
  expect(JSON.parse(output.stdout())).toEqual([page]);
});

test("research controls preserve stdout and expose metadata only on opt-in", async () => {
  const metadata = {
    actualCostUsd: 0,
    estimatedCostUsd: 0.024,
    unknownCost: false,
    tasks: [{ source: "cache", ageSeconds: 9, ttlSeconds: 86400 }],
    jobStatus: "complete",
  };
  const headers = {
    "X-Naps-Metadata": JSON.stringify(metadata),
    "X-Naps-Request-Id": "server-run",
    "X-Naps-Provider-Cost": "0",
  };
  for (const command of ["keywords", "keywords-website", "keywords-serp", "keywords-bulk"]) {
    for (const optedIn of [false, true]) {
      globalThis.fetch = (async (request: Request) => {
        expect(request.headers.get("X-Naps-Refresh")).toBe(optedIn ? "true" : null);
        expect(request.headers.get("X-Naps-Max-Cost-USD")).toBe(optedIn ? "0" : null);
        expect(request.headers.get("Idempotency-Key")).toBe(
          optedIn && command === "keywords-bulk" ? "my-run" : null,
        );
        expect(request.headers.get("X-Naps-Client-Type")).toBe("cli");
        return Response.json(
          command === "keywords-bulk"
            ? { results: [], totalKeywords: 0 }
            : { keywordSuggestions: [], keywords: [], results: [], cost: 0 },
          { headers },
        );
      }) as unknown as typeof fetch;
      const output = capture();
      await run(
        app,
        [
          command,
          "seed",
          ...(optedIn
            ? [
                "--refresh",
                "--budget",
                "0",
                "--metadata",
                ...(command === "keywords-bulk" ? ["--request-id", "my-run"] : []),
              ]
            : []),
        ],
        output.context,
      );
      expect(output.context.process.exitCode).toBe(0);
      expect(JSON.parse(output.stdout())).toEqual(
        command === "keywords-bulk" ? { results: [], totalKeywords: 0 } : [],
      );
      if (optedIn)
        expect(JSON.parse(output.stderr())).toEqual({
          seo: { requestId: "server-run", providerCostUsd: 0, metadata },
        });
      else expect(output.stderr()).toBe("");
    }
  }
});

test("bulk budget stops retain entries and resume controls do not rewrite inputs", async () => {
  const data = {
    results: [
      { keyword: "a", suggestions: [keyword(5)], count: 1, cost: 0.024 },
      { keyword: "b", suggestions: [], count: 0, cost: 0, error: "BUDGET_EXCEEDED" },
      { keyword: "a", suggestions: [keyword(5)], count: 1, cost: 0 },
    ],
    totalKeywords: 3,
  };
  const metadata = {
    actualCostUsd: null,
    estimatedCostUsd: 0.048,
    unknownCost: true,
    jobStatus: "partial",
  };
  globalThis.fetch = (async (request: Request) => {
    expect(await request.json()).toEqual({ keywords: " a \nb\n a " });
    expect(request.headers.get("Idempotency-Key")).toBe("resume-run");
    expect(request.headers.get("X-Naps-Max-Cost-USD")).toBe("0.025");
    return Response.json(data, { headers: { "X-Naps-Metadata": JSON.stringify(metadata) } });
  }) as unknown as typeof fetch;
  const output = capture();
  await run(
    app,
    [
      "keywords-bulk",
      " a ",
      "b",
      " a ",
      "--request-id",
      "resume-run",
      "--budget",
      "0.025",
      "--metadata",
    ],
    output.context,
  );
  expect(output.context.process.exitCode).toBe(0);
  expect(JSON.parse(output.stdout())).toEqual(data);
  expect(JSON.parse(output.stderr())).toEqual({
    seo: { requestId: null, providerCostUsd: null, metadata },
  });
});

test("budget and idempotency failures remain one structured stderr document", async () => {
  for (const [status, command, code] of [
    [402, "keywords", "SEO_BUDGET_EXCEEDED"],
    [409, "keywords-bulk", "SEO_REQUEST_ID_CONFLICT"],
  ] as const) {
    globalThis.fetch = (async () =>
      Response.json(
        { error: "REFUSED" },
        {
          status,
          headers: {
            "X-Naps-Metadata": JSON.stringify({ jobStatus: "partial" }),
            "X-Naps-Request-Id": "failed-run",
          },
        },
      )) as unknown as typeof fetch;
    const output = capture();
    await run(app, [command, "seed", "--metadata"], output.context);
    expect(output.context.process.exitCode).not.toBe(0);
    expect(output.stdout()).toBe("");
    expect(JSON.parse(output.stderr())).toMatchObject({
      error: {
        code,
        details: {
          seo: {
            requestId: "failed-run",
            providerCostUsd: null,
            metadata: { jobStatus: "partial" },
          },
        },
      },
    });
  }
});

test("ambiguous provider completion requires reconciliation, not a fresh retry", async () => {
  const metadata = { actualCostUsd: null, unknownCost: true, jobStatus: "partial" };
  globalThis.fetch = (async () =>
    Response.json(
      { error: "AMBIGUOUS_PROVIDER_OUTCOME" },
      { status: 409, headers: { "X-Naps-Metadata": JSON.stringify(metadata) } },
    )) as unknown as typeof fetch;
  for (const flags of [[], ["--refresh", "--metadata"]]) {
    const output = capture();
    await run(app, ["keywords", "seed", ...flags], output.context);
    expect(output.context.process.exitCode).not.toBe(0);
    expect(output.stdout()).toBe("");
    const { error } = JSON.parse(output.stderr());
    expect(error).toMatchObject({
      code: "SEO_AMBIGUOUS_PROVIDER_OUTCOME",
      message: "The provider task's completion and cost are unknown. Research is held.",
      hint: "Do not retry, refresh, or choose a new request ID. Contact the service operator to reconcile the provider task.",
    });
    if (flags.length) expect(error.details.seo).toMatchObject({ providerCostUsd: null, metadata });
  }
});

test("invalid budgets fail before requests and malformed metadata does not discard results", async () => {
  globalThis.fetch = (async () => {
    throw new Error("must not make a request");
  }) as unknown as typeof fetch;
  for (const budget of ["-0.01", "NaN", "Infinity", "", " "]) {
    const output = capture();
    await run(app, ["keywords", "seed", "--budget", budget], output.context);
    expect(JSON.parse(output.stderr()).error.code).toBe("INVALID_ARGUMENTS");
    expect(output.stdout()).toBe("");
  }
  const emptyId = capture();
  await run(app, ["keywords-bulk", "seed", "--request-id", " "], emptyId.context);
  expect(JSON.parse(emptyId.stderr()).error.code).toBe("INVALID_ARGUMENTS");
  globalThis.fetch = (async () =>
    Response.json(
      { keywordSuggestions: [keyword(2)] },
      { headers: { "X-Naps-Metadata": "not-json", "X-Naps-Provider-Cost": "" } },
    )) as unknown as typeof fetch;
  const output = capture();
  await run(app, ["keywords", "seed", "--metadata"], output.context);
  expect(output.context.process.exitCode).toBe(0);
  expect(JSON.parse(output.stdout())[0].keyword).toBe("candidate-2");
  expect(JSON.parse(output.stderr())).toEqual({
    seo: {
      requestId: null,
      providerCostUsd: null,
      metadata: null,
      metadataError: "INVALID_METADATA",
    },
  });
});
