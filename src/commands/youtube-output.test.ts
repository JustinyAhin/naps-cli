import { afterEach, expect, test } from "bun:test";
import { run } from "@stricli/core";
import { app } from "../cli/app";
import { createContext, type CliContext } from "../cli/context";

const originalFetch = globalThis.fetch;
const originalKey = process.env.NAPS_CLI_API_KEY;
const videoId = "Y8Wu4rSNJms";
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NAPS_CLI_API_KEY;
  else process.env.NAPS_CLI_API_KEY = originalKey;
});
const capture = () => {
  let stdout = "";
  let stderr = "";
  process.env.NAPS_CLI_API_KEY = "youtube-test-key";
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
  return { context, stdout: () => stdout, stderr: () => stderr };
};

test("YouTube commands preserve channel fields, full comments, and timed transcript output", async () => {
  const channel = {
    type: "youtube_channel",
    title: "Example",
    channelId: "UCexample",
    videoCount: 42,
    verified: true,
  };
  const comment = { text: "Customer feedback. ".repeat(100), author: "Customer", likes: null };
  const transcript = {
    videoId,
    available: true,
    originLanguage: "en",
    translateLanguage: "fr",
    unsupportedLanguage: false,
    text: "Première ligne\nDeuxième ligne",
    segments: [
      { text: "Première ligne", startSeconds: 0.25, endSeconds: 1.5, durationSeconds: 1.25 },
    ],
  };
  for (const [command, data, expected] of [
    ["youtube-search", { results: [channel], cost: 0.002 }, [channel]],
    [
      "youtube-comments",
      { videoId, title: "Video", totalComments: 200, comments: [comment], cost: 0.002 },
      { videoId, title: "Video", totalComments: 200, comments: [comment] },
    ],
    ["youtube-transcript", { ...transcript, cost: 0.006 }, transcript],
  ] as const) {
    for (const withMetadata of [false, true]) {
      globalThis.fetch = (async (request: Request) => {
        const url = new URL(request.url);
        expect(url.pathname).toBe(`/api/cli/seo/youtube/${command.slice("youtube-".length)}`);
        expect(url.searchParams.get("location_name")).toBe("France");
        expect(url.searchParams.get("language_name")).toBe("French");
        expect(request.headers.get("X-Naps-Client-Type")).toBe("cli");
        expect(request.headers.get("X-Naps-Refresh")).toBe("true");
        expect(request.headers.get("X-Naps-Max-Cost-USD")).toBe("0.006");
        if (command === "youtube-search") expect(url.searchParams.get("keyword")).toBe("Example");
        else expect(url.searchParams.get("video_id")).toBe(videoId);
        if (command === "youtube-transcript") {
          expect(url.searchParams.get("subtitles_language")).toBe("en");
          expect(url.searchParams.get("translate_language")).toBe("fr");
        }
        return Response.json(data, {
          headers: {
            "X-Naps-Request-Id": "youtube-run",
            "X-Naps-Provider-Cost": String(data.cost),
            "X-Naps-Metadata": JSON.stringify({ tasks: [{ source: "provider" }] }),
          },
        });
      }) as unknown as typeof fetch;
      const output = capture();
      await run(
        app,
        [
          command,
          command === "youtube-search" ? " Example " : `https://youtu.be/${videoId}?t=15`,
          "--location",
          "France",
          "--language",
          "French",
          "--refresh",
          "--budget",
          "0.006",
          ...(withMetadata ? ["--metadata"] : []),
          ...(command === "youtube-transcript"
            ? ["--subtitles-language", "en", "--translate-language", "fr"]
            : []),
        ],
        output.context,
      );
      expect(output.context.process.exitCode).toBe(0);
      expect(JSON.parse(output.stdout())).toEqual(expected);
      if (withMetadata)
        expect(JSON.parse(output.stderr())).toMatchObject({
          seo: { requestId: "youtube-run", providerCostUsd: data.cost },
        });
      else expect(output.stderr()).toBe("");
    }
  }
});

test("video URL forms normalize to one ID and invalid inputs make no requests", async () => {
  let requests = 0;
  globalThis.fetch = (async (request: Request) => {
    requests += 1;
    expect(new URL(request.url).searchParams.get("video_id")).toBe(videoId);
    return Response.json({ videoId, comments: [] });
  }) as unknown as typeof fetch;
  for (const input of [
    videoId,
    `https://www.youtube.com/watch?v=${videoId}&t=10`,
    `https://youtu.be/${videoId}`,
    `https://youtube.com/shorts/${videoId}`,
    `https://m.youtube.com/live/${videoId}`,
    `https://youtube.com/embed/${videoId}`,
  ]) {
    const output = capture();
    await run(app, ["youtube-comments", input], output.context);
    expect(output.context.process.exitCode).toBe(0);
  }
  const start = requests;
  for (const args of [
    ["youtube-comments", `https://youtube.com.evil.test/watch?v=${videoId}`],
    ["youtube-comments", `https://user@youtube.com/watch?v=${videoId}`],
    ["youtube-comments", "https://www.youtube.com/@example"],
    ["youtube-comments", "short-id"],
    ["youtube-transcript", videoId, "--subtitles-language", "English"],
    ["youtube-transcript", videoId, "--translate-language", " "],
    ["youtube-search", " "],
    ["youtube-search", "x".repeat(701)],
    ["youtube-search", "query", "--budget", "-1"],
  ]) {
    const output = capture();
    await run(app, args, output.context);
    expect(output.context.process.exitCode).not.toBe(0);
    expect(output.stdout()).toBe("");
    expect(JSON.parse(output.stderr()).error.code).toBe("INVALID_ARGUMENTS");
  }
  expect(requests).toBe(start);
});

test("YouTube failures use structured stderr without exposing provider or account credentials", async () => {
  for (const command of ["youtube-search", "youtube-comments", "youtube-transcript"]) {
    for (const [status, error, code] of [
      [401, "UNAUTHORIZED", "SEO_AUTH_FAILED"],
      [402, "BUDGET_EXCEEDED", "SEO_BUDGET_EXCEEDED"],
      [409, "AMBIGUOUS_PROVIDER_OUTCOME", "SEO_AMBIGUOUS_PROVIDER_OUTCOME"],
      [429, "CLI_QUOTA_EXCEEDED", "NAPS_QUOTA_EXCEEDED"],
      [502, "UPSTREAM_FAILURE", "SEO_API_UNAVAILABLE"],
    ] as const) {
      let requests = 0;
      globalThis.fetch = (async () => {
        requests += 1;
        return Response.json({ error, secret: "private-provider-value" }, { status });
      }) as unknown as typeof fetch;
      const output = capture();
      await run(
        app,
        [command, command === "youtube-search" ? "query" : videoId, "--metadata"],
        output.context,
      );
      expect(output.context.process.exitCode).not.toBe(0);
      expect(output.stdout()).toBe("");
      expect(JSON.parse(output.stderr()).error.code).toBe(code);
      expect(output.stderr()).not.toContain("private-provider-value");
      expect(output.stderr()).not.toContain("youtube-test-key");
      expect(requests).toBe(1);
    }
  }
});

test("missing captions remain explicit in successful transcript JSON", async () => {
  const data = {
    videoId,
    available: false,
    unsupportedLanguage: true,
    originLanguage: null,
    translateLanguage: null,
    text: "",
    segments: [],
    cost: 0.006,
  };
  globalThis.fetch = (async () => Response.json(data)) as unknown as typeof fetch;
  const output = capture();
  await run(app, ["youtube-transcript", videoId], output.context);
  expect(output.context.process.exitCode).toBe(0);
  expect(JSON.parse(output.stdout())).toMatchObject({ available: false, text: "", segments: [] });
});

const localPlayer = {
  playabilityStatus: { status: "OK" },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" },
      ],
    },
  },
};

const mockLocalYoutube = ({
  player = localPlayer,
  xml = '<transcript><text start="0.25" dur="1.25">It&amp;#39;s &amp;quot;ready&amp;quot; &amp;amp; tested.</text><text start="2.5" dur="1">Next &amp;#x1F600;</text></transcript>',
}: { player?: unknown; xml?: string } = {}) => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    expect(url.hostname).toBe("www.youtube.com");
    expect(url.protocol).toBe("https:");
    expect(request.headers.has("Authorization")).toBe(false);
    expect(request.headers.has("X-Naps-Client-Type")).toBe(false);
    if (url.pathname === "/watch") return new Response('"INNERTUBE_API_KEY":"public-test-key"');
    if (url.pathname === "/youtubei/v1/player") {
      expect(request.method).toBe("POST");
      expect((await request.json()).videoId).toBe(videoId);
      return Response.json(player);
    }
    expect(url.pathname).toBe("/api/timedtext");
    return new Response(xml);
  }) as typeof fetch;
  return requests;
};

test("local captions need no key and preserve text, timed segments, and zero-cost metadata", async () => {
  for (const withMetadata of [false, true]) {
    const requests = mockLocalYoutube();
    const output = capture();
    delete process.env.NAPS_CLI_API_KEY;
    await run(
      app,
      [
        "youtube-transcript",
        `https://youtu.be/${videoId}`,
        "--provider",
        "local",
        "--subtitles-language",
        "en",
        "--budget",
        "0",
        "--refresh",
        ...(withMetadata ? ["--metadata"] : []),
      ],
      output.context,
    );
    expect(output.context.process.exitCode).toBe(0);
    expect(requests).toHaveLength(3);
    expect(JSON.parse(output.stdout())).toEqual({
      videoId,
      available: true,
      unsupportedLanguage: false,
      originLanguage: "en",
      translateLanguage: null,
      text: 'It\'s "ready" & tested.\nNext 😀',
      segments: [
        {
          text: 'It\'s "ready" & tested.',
          startSeconds: 0.25,
          endSeconds: 1.5,
          durationSeconds: 1.25,
        },
        { text: "Next 😀", startSeconds: 2.5, endSeconds: 3.5, durationSeconds: 1 },
      ],
    });
    if (withMetadata)
      expect(JSON.parse(output.stderr())).toEqual({
        seo: { requestId: null, providerCostUsd: 0, metadata: { provider: "local" } },
      });
    else expect(output.stderr()).toBe("");
  }
});

test("local provider rejects unsupported options before any request", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    throw new Error("No requests expected");
  }) as unknown as typeof fetch;
  for (const args of [
    ["--provider", "unknown"],
    ["--provider", "local", "--translate-language", "fr"],
    ["--provider", "local", "--location", "France"],
    ["--provider", "local", "--language", "French"],
  ]) {
    const output = capture();
    await run(app, ["youtube-transcript", videoId, ...args], output.context);
    expect(output.context.process.exitCode).not.toBe(0);
    expect(output.stdout()).toBe("");
    expect(JSON.parse(output.stderr()).error.code).toBe("INVALID_ARGUMENTS");
  }
  expect(requests).toBe(0);
});

test("local provider distinguishes absent captions from an unavailable caption language", async () => {
  for (const unsupported of [false, true]) {
    const requests = mockLocalYoutube({
      player: unsupported ? localPlayer : { playabilityStatus: { status: "OK" } },
    });
    const output = capture();
    await run(
      app,
      [
        "youtube-transcript",
        videoId,
        "--provider",
        "local",
        "--subtitles-language",
        unsupported ? "fr" : "en",
      ],
      output.context,
    );
    expect(output.context.process.exitCode).toBe(0);
    expect(requests).toHaveLength(2);
    expect(JSON.parse(output.stdout())).toEqual({
      videoId,
      available: false,
      unsupportedLanguage: unsupported,
      originLanguage: null,
      translateLanguage: null,
      text: "",
      segments: [],
    });
  }
});

test("local failures stay local and never expose request data or fall back to a paid provider", async () => {
  for (const [status, code] of [
    [403, "YOUTUBE_ACCESS_BLOCKED"],
    [429, "YOUTUBE_RATE_LIMITED"],
    [503, "YOUTUBE_REQUEST_FAILED"],
  ] as const) {
    let requests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests += 1;
      expect(new URL(String(input)).hostname).toBe("www.youtube.com");
      return new Response("private-provider-value", { status });
    }) as typeof fetch;
    const output = capture();
    await run(
      app,
      ["youtube-transcript", videoId, "--provider", "local", "--metadata"],
      output.context,
    );
    expect(output.context.process.exitCode).not.toBe(0);
    expect(output.stdout()).toBe("");
    expect(JSON.parse(output.stderr()).error).toMatchObject({
      code,
      details: { seo: { providerCostUsd: 0, metadata: { provider: "local" } } },
    });
    expect(output.stderr()).not.toContain("private-provider-value");
    expect(output.stderr()).not.toContain("youtube-test-key");
    expect(requests).toBe(1);
  }
});

test("invalid or ambiguous local responses do not become missing-caption successes", async () => {
  for (const fixture of [
    { xml: "<html>Try again later</html>" },
    { xml: '<transcript><text start="-1" dur="1">Invalid time</text></transcript>' },
    { xml: '<transcript><text start="0" dur="NaN">Invalid time</text></transcript>' },
    { player: { playabilityStatus: { status: "LOGIN_REQUIRED" } } },
  ]) {
    mockLocalYoutube(fixture);
    const output = capture();
    await run(app, ["youtube-transcript", videoId, "--provider", "local"], output.context);
    expect(output.context.process.exitCode).not.toBe(0);
    expect(output.stdout()).toBe("");
    expect(JSON.parse(output.stderr()).error.code).toMatch(
      /^YOUTUBE_(INVALID_RESPONSE|REQUEST_FAILED)$/,
    );
  }
});
