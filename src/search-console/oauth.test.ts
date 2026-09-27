import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  buildAuthorizationUrl,
  createPkce,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "./oauth";
import type { ResolvedCredentials } from "./types";

describe("Google OAuth", () => {
  test("builds a desktop authorization URL with PKCE and offline access", () => {
    const url = buildAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "http://127.0.0.1:1234/oauth2/callback",
      state: "state-value",
      challenge: "challenge-value",
    });
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  test("derives the PKCE challenge from the verifier", async () => {
    const pkce = await createPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier).digest("base64url"));
  });

  test("exchanges a code for refreshable credentials", async () => {
    let tokenRequest: RequestInit | undefined;
    const credentials = await exchangeAuthorizationCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "code",
      verifier: "verifier",
      redirectUri: "http://127.0.0.1/callback",
      fetcher: async (_input, init) => {
        tokenRequest = init;
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "scope-one scope-two",
          }),
          { status: 200 },
        );
      },
    });
    expect(new URLSearchParams(String(tokenRequest?.body)).get("client_secret")).toBe(
      "client-secret",
    );
    expect(credentials.refreshToken).toBe("refresh-token");
    expect(credentials.scope).toEqual(["scope-one", "scope-two"]);
  });

  test("maps invalid grants to a reconnect error", async () => {
    const resolved: ResolvedCredentials = {
      source: "environment",
      credentials: {
        refreshToken: "revoked-token",
        scope: [],
        connectedAt: "environment",
      },
    };
    expect(
      refreshAccessToken({
        resolved,
        clientId: "client-id",
        clientSecret: "client-secret",
        fetcher: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      }),
    ).rejects.toMatchObject({ code: "SEARCH_CONSOLE_REAUTH_REQUIRED" });
  });
});
