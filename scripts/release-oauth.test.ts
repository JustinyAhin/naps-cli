import { expect, test } from "bun:test";
import { BUILT_IN_GOOGLE_CLIENT_ID } from "../src/search-console/oauth";
import { validateReleaseOAuth } from "./release-oauth";

const env = { NAPS_GSC_CLIENT_SECRET: "secret", NAPS_GSC_REFRESH_TOKEN: "refresh" };

test("validates the bundled client with a real refresh request", async () => {
  let called = false;
  await validateReleaseOAuth({
    env,
    fetcher: async (input, init) => {
      called = true;
      expect(input).toBe("https://oauth2.googleapis.com/token");
      const body = init?.body as URLSearchParams;
      expect(body.get("client_id")).toBe(BUILT_IN_GOOGLE_CLIENT_ID);
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("refresh_token")).toBe("refresh");
      expect(body.get("grant_type")).toBe("refresh_token");
      return Response.json({ access_token: "access", expires_in: 3600 });
    },
  });
  expect(called).toBe(true);
});

for (const code of ["invalid_client", "invalid_grant", "server_error"]) {
  test(`blocks release on ${code} without leaking provider response`, async () => {
    await expect(
      validateReleaseOAuth({
        env,
        fetcher: async () =>
          Response.json(
            { error: code, error_description: "sensitive provider response" },
            { status: 400 },
          ),
      }),
    ).rejects.toThrow(
      code === "invalid_client"
        ? "Google rejected"
        : code === "invalid_grant"
          ? "fresh connection"
          : "validation failed",
    );
  });
}

test("rejects missing secret and mismatched client before network access", async () => {
  await expect(validateReleaseOAuth({ env: {} })).rejects.toThrow("NAPS_GSC_CLIENT_SECRET");
  await expect(
    validateReleaseOAuth({ env: { ...env, NAPS_GSC_CLIENT_ID: "other" } }),
  ).rejects.toThrow("must match");
});

test("blocks release on network failures without leaking errors", async () => {
  await expect(
    validateReleaseOAuth({
      env,
      fetcher: async () => {
        throw new Error("secret");
      },
    }),
  ).rejects.toThrow("Check Google connectivity");
});
