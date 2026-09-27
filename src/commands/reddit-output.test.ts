import { afterEach, expect, test } from "bun:test";
import type { CliContext } from "../cli/context";
import search from "./reddit-search";
import post from "./reddit-post";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
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
  return {
    context: {
      process: {
        stdout: {
          write: (value: string) => {
            stdout += value;
          },
        },
      },
    } as unknown as CliContext,
    value: () => JSON.parse(stdout),
  };
};

test("search preserves provenance, honors limits above 15, and exposes text shortening", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      posts: Array.from({ length: 22 }, (_, i) => ({ ...submission, id: String(i) })),
      total: 22,
    })) as unknown as typeof fetch;
  const output = capture();
  await search.call(output.context, { limit: 20, sort: "new", time: "year" }, "costing");
  const results = output.value();
  expect(results).toHaveLength(20);
  expect(results[0]).toMatchObject({
    author: "operator",
    created_utc: 1700000000,
    permalink: submission.permalink,
    selftext_truncated: true,
  });
  expect(results[0].selftext).toHaveLength(600);
  const full = capture();
  await search.call(full.context, { limit: 1, sort: "new", time: "year", full: true }, "costing");
  expect(full.value()[0]).toMatchObject({
    selftext: submission.selftext,
    selftext_truncated: false,
  });
});

test("post full mode retains long text and nested replies without claiming upstream completeness", async () => {
  const comments = Array.from({ length: 16 }, () => ({
    ...comment,
    replies: [{ ...comment, id: "reply", parent_id: "t1_def456", depth: 1 }],
  }));
  globalThis.fetch = (async () =>
    Response.json({ post: submission, comments })) as unknown as typeof fetch;
  const output = capture();
  await post.call(output.context, {}, submission.permalink);
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
  expect(compact.comments[0]).toMatchObject({ body_truncated: true, replies_omitted: true });
  const full = capture();
  await post.call(full.context, { full: true }, submission.permalink);
  const result = full.value();
  expect(result).toMatchObject({
    selftext: submission.selftext,
    selftext_truncated: false,
    comments_truncated: false,
    comments_complete: false,
  });
  expect(result.comments).toHaveLength(16);
  expect(result.comments[0]).toMatchObject({
    body: comment.body,
    body_truncated: false,
    replies_omitted: false,
  });
  expect(result.comments[0].replies[0]).toMatchObject({
    id: "reply",
    parent_id: "t1_def456",
    depth: 1,
    body: comment.body,
  });
});
