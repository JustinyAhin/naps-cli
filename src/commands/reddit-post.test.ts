import { describe, expect, test } from "bun:test";
import { isRedditPostUrl } from "./reddit-post";

describe("Reddit post URL validation", () => {
  test("accepts Reddit URLs and rejects unrelated or incomplete URLs", () => {
    expect(
      isRedditPostUrl({ value: "https://www.reddit.com/r/test/comments/abc123/a_post/" }),
    ).toBe(true);
    expect(isRedditPostUrl({ value: "https://redd.it/abc123" })).toBe(true);
    expect(isRedditPostUrl({ value: "https://example.com/r/test/comments/abc123" })).toBe(false);
    expect(isRedditPostUrl({ value: "not-a-url" })).toBe(false);
  });
});
