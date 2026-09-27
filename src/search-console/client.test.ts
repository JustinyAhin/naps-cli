import { describe, expect, test } from "bun:test";
import { normalizeAnalyticsRows, queryAnalytics } from "./client";

describe("Search Console API client", () => {
  test("normalizes dimension keys into named fields", () => {
    expect(
      normalizeAnalyticsRows({
        dimensions: ["query", "page"],
        response: {
          rows: [
            {
              keys: ["market research", "https://example.com/research"],
              clicks: 12,
              impressions: 120,
              ctr: 0.1,
              position: 3.5,
            },
          ],
        },
      }),
    ).toEqual([
      {
        query: "market research",
        page: "https://example.com/research",
        clicks: 12,
        impressions: 120,
        ctr: 0.1,
        position: 3.5,
      },
    ]);
  });

  test("refreshes and sends a normalized analytics query", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          rows: [{ keys: ["idea validation"], clicks: 4, impressions: 40, ctr: 0.1, position: 2 }],
          responseAggregationType: "byProperty",
        }),
        { status: 200 },
      );
    };

    const result = await queryAnalytics({
      input: {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-07-01",
        endDate: "2026-07-28",
        dimensions: ["query"],
        type: "web",
        limit: 25,
      },
      env: {
        NAPS_GSC_CLIENT_ID: "client-id",
        NAPS_GSC_CLIENT_SECRET: "client-secret",
        NAPS_GSC_REFRESH_TOKEN: "refresh-token",
      },
      fetcher,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain("sc-domain%3Aexample.com/searchAnalytics/query");
    expect(new Headers(requests[1]?.init?.headers).get("Authorization")).toBe("Bearer access");
    expect(result.rows[0]?.query).toBe("idea validation");
    expect(result.responseAggregationType).toBe("byProperty");
  });
});
