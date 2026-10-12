import { describe, expect, test } from "bun:test";
import { queryAnalytics } from "./client";

describe("Search Console API client", () => {
  test("refreshes, retries a 401 once, and returns named analytics rows", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let tokenRequests = 0;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("oauth2.googleapis.com/token")) {
        tokenRequests += 1;
        expect(new URLSearchParams(init?.body as URLSearchParams).get("refresh_token")).toBe(
          "refresh-token",
        );
        return Response.json({ access_token: `access-${tokenRequests}`, expires_in: 3600 });
      }
      if (new Headers(init?.headers).get("Authorization") === "Bearer access-1") {
        return Response.json(
          { error: { status: "UNAUTHENTICATED", message: "expired" } },
          { status: 401 },
        );
      }
      return new Response(
        JSON.stringify({
          rows: [
            {
              keys: ["https://example.com/research", "market research"],
              clicks: 12,
              impressions: 120,
              ctr: 0.1,
              position: 3.5,
            },
            {
              keys: ["https://example.com/ideas", "idea validation"],
              clicks: 4,
              impressions: 40,
              ctr: 0.1,
              position: 2,
            },
            { keys: ["https://example.com/empty"] },
          ],
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
        dimensions: ["page", "query"],
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

    expect(requests).toHaveLength(4);
    expect(requests[1]?.url).toContain("sc-domain%3Aexample.com/searchAnalytics/query");
    expect(requests[3]?.url).toBe(requests[1]?.url);
    expect(new Headers(requests[3]?.init?.headers).get("Authorization")).toBe("Bearer access-2");
    const queryBody = {
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      dimensions: ["page", "query"],
      type: "web",
      rowLimit: 25,
      dataState: "final",
    };
    for (const request of [requests[1], requests[3]]) {
      expect(request?.init?.method).toBe("POST");
      expect(JSON.parse(request?.init?.body as string)).toEqual(queryBody);
    }
    expect(result).toMatchObject({
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      dimensions: ["page", "query"],
      type: "web",
      rows: [
        {
          page: "https://example.com/research",
          query: "market research",
          clicks: 12,
          impressions: 120,
          ctr: 0.1,
          position: 3.5,
        },
        {
          page: "https://example.com/ideas",
          query: "idea validation",
          clicks: 4,
          impressions: 40,
          ctr: 0.1,
          position: 2,
        },
        {
          page: "https://example.com/empty",
          query: "",
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
        },
      ],
    });
    expect(result.responseAggregationType).toBe("byProperty");
    for (const secret of ["client-secret", "refresh-token", "access-1", "access-2"]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
});
