import { afterEach, beforeEach, expect, test } from "bun:test";
import { run } from "@stricli/core";
import { app } from "../cli/app";
import { createContext } from "../cli/context";
import type { CliContext } from "../cli/context";

const originalFetch = globalThis.fetch;
const originalKey = process.env.NAPS_CLI_API_KEY;
const localKey = "reddit-test-not-a-real-key";
beforeEach(() => {
  process.env.NAPS_CLI_API_KEY = localKey;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NAPS_CLI_API_KEY;
  else process.env.NAPS_CLI_API_KEY = originalKey;
});
const submission = {
  id: "abc123",
  author: "operator",
  created_utc: 1700000000,
  title: "Costing",
  subreddit: "Chefit",
  score: 1,
  num_comments: 30,
  permalink: "https://reddit.com/r/Chefit/comments/abc123/costing/",
  selftext: "x".repeat(3100),
  url: "https://reddit.com",
  is_self: true,
  over_18: false,
};
const comment = {
  id: "def456",
  author: "chef",
  created_utc: 1700000010,
  parent_id: "t3_abc123",
  body: "y".repeat(550),
  score: 2,
  depth: 0,
  is_submitter: false,
  replies: [],
};
const capture = () => {
  let stdout = "";
  let stderr = "";
  return {
    context: {
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
    } as unknown as CliContext & { process: { exitCode?: number | string | null } },
    value: () => JSON.parse(stdout),
    stdout: () => stdout,
    stderr: () => stderr,
  };
};

test("search preserves provenance, honors limits above 15, and exposes text shortening", async () => {
  const posts = Array.from({ length: 22 }, (_, i) => ({
    ...submission,
    id: String((i * 7) % 22),
    score: (i * 3) % 22,
    created_utc: 1700000000 + ((i * 5) % 22),
  }));
  let requests = 0;
  globalThis.fetch = (async (request: Request) => {
    requests += 1;
    const query = new URL(request.url).searchParams;
    expect(query.get("keywords")).toBe("costing");
    expect(query.get("sort")).toBe("new");
    expect(query.get("t")).toBe("year");
    expect(query.get("subreddit")).toBe("Chefit");
    expect(query.get("limit")).toBe(requests === 1 ? "20" : "1");
    return Response.json({ posts, total: 22 });
  }) as unknown as typeof fetch;
  const output = capture();
  const args = [
    "reddit-search",
    "costing",
    "--sort",
    "new",
    "--time",
    "year",
    "--subreddit",
    "Chefit",
    "--limit",
  ];
  await run(app, [...args, "20"], output.context);
  expect(output.context.process.exitCode).toBe(0);
  expect(output.stderr()).toBe("");
  const results = output.value();
  expect(results).toHaveLength(20);
  expect(
    results.map((result: { id: string; score: number; created_utc: number }) => [
      result.id,
      result.score,
      result.created_utc,
    ]),
  ).toEqual(posts.slice(0, 20).map((post) => [post.id, post.score, post.created_utc]));
  expect(results[0]).toMatchObject({
    author: "operator",
    created_utc: 1700000000,
    permalink: submission.permalink,
    selftext_truncated: true,
  });
  expect(results[0].selftext).toHaveLength(600);
  const full = capture();
  await run(app, [...args, "1", "--full"], full.context);
  expect(full.context.process.exitCode).toBe(0);
  expect(full.stderr()).toBe("");
  expect(full.value()[0]).toMatchObject({
    selftext: submission.selftext,
    selftext_truncated: false,
  });
  expect(requests).toBe(2);
  expect(output.stdout() + full.stdout()).not.toContain(localKey);
});

test("post validates URLs and retains provider order, text, and replies without claiming completeness", async () => {
  const comments = Array.from({ length: 16 }, (_, i) => ({
    ...comment,
    id: `comment-${(i * 7) % 16}`,
    score: (i * 3) % 16,
    replies: [{ ...comment, id: `reply-${i}`, parent_id: `t1_comment-${(i * 7) % 16}`, depth: 1 }],
  }));
  let requests = 0;
  globalThis.fetch = (async (request: Request) => {
    requests += 1;
    expect(new URL(request.url).searchParams.get("url")).toBe(
      requests === 1 ? submission.permalink : "https://redd.it/abc123",
    );
    return Response.json({ post: submission, comments });
  }) as unknown as typeof fetch;
  const output = capture();
  await run(app, ["reddit-post", submission.permalink], output.context);
  expect(output.context.process.exitCode).toBe(0);
  expect(output.stderr()).toBe("");
  const compact = output.value();
  expect(compact).toMatchObject({
    id: "abc123",
    created_utc: 1700000000,
    permalink: submission.permalink,
    selftext_truncated: true,
    comments_truncated: true,
    comments_complete: false,
  });
  expect(compact.comments).toHaveLength(15);
  expect(
    compact.comments.map((item: { id: string; score: number }) => [item.id, item.score]),
  ).toEqual(comments.slice(0, 15).map((item) => [item.id, item.score]));
  expect(compact.selftext).toHaveLength(3000);
  expect(compact.comments[0].body).toHaveLength(500);
  expect(compact.comments[0]).not.toHaveProperty("replies");
  expect(compact.comments[0]).toMatchObject({ body_truncated: true, replies_omitted: true });
  const full = capture();
  await run(app, ["reddit-post", "https://redd.it/abc123", "--full"], full.context);
  expect(full.context.process.exitCode).toBe(0);
  expect(full.stderr()).toBe("");
  const result = full.value();
  expect(result).toMatchObject({
    selftext: submission.selftext,
    selftext_truncated: false,
    comments_truncated: false,
    comments_complete: false,
  });
  expect(result.comments).toHaveLength(16);
  expect(
    result.comments.map((item: { id: string; score: number }) => [item.id, item.score]),
  ).toEqual(comments.map((item) => [item.id, item.score]));
  expect(result.comments[0]).toMatchObject({
    body: comment.body,
    body_truncated: false,
    replies_omitted: false,
  });
  expect(result.comments[0].replies[0]).toMatchObject({
    id: "reply-0",
    parent_id: "t1_comment-0",
    depth: 1,
    body: comment.body,
  });
  for (const url of [
    "https://example.com/r/test/comments/abc123",
    "not-a-url",
    "https://reddit.com/",
    "ftp://redd.it/abc123",
    "https://reddit.com.evil.test/comments/abc123",
  ]) {
    const invalid = capture();
    await run(app, ["reddit-post", url], invalid.context);
    expect(invalid.context.process.exitCode).not.toBe(0);
    expect(invalid.stdout()).toBe("");
    expect(JSON.parse(invalid.stderr()).error.code).toBe("INVALID_REDDIT_URL");
    expect(invalid.stderr()).not.toContain(localKey);
  }
  expect(requests).toBe(2);
  expect(output.stdout() + full.stdout()).not.toContain(localKey);
});
