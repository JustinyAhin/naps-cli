import { describe, expect, test } from "bun:test";
import { redditApiError, requestFailure } from "./service-errors";

describe("CLI service errors", () => {
  test("explains when hosted Reddit is unavailable for an account", () => {
    const error = redditApiError({
      response: new Response(null, { status: 403 }),
      error: { error: "CLI_SERVICE_DISABLED" },
    });
    expect(error.code).toBe("REDDIT_NOT_ENABLED");
  });

  test("keeps only safe Reddit validation details", () => {
    const error = redditApiError({
      response: new Response(null, { status: 422 }),
      error: {
        detail: [
          {
            loc: ["query", "url"],
            msg: "Enter a valid URL.",
            input: "private raw input",
          },
        ],
      },
    });

    expect(error).toMatchObject({
      code: "REDDIT_INVALID_REQUEST",
      message: "Enter a valid URL.",
      details: { issues: [{ path: "query.url", message: "Enter a valid URL." }] },
    });
    expect(JSON.stringify(error.details)).not.toContain("private raw input");
  });

  test("distinguishes network failures without exposing their message", () => {
    const error = requestFailure({
      error: new TypeError("request with secret query failed"),
      service: "the SEO API",
      code: "SEO",
    });
    expect(error).toMatchObject({
      code: "SEO_NETWORK_ERROR",
      message: "Could not reach the SEO API.",
    });
    expect(error.message).not.toContain("secret");
  });
});
