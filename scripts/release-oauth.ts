import { resolveCredentials } from "../src/search-console/config";
import {
  BUILT_IN_GOOGLE_CLIENT_ID,
  GoogleOAuthError,
  refreshAccessToken,
} from "../src/search-console/oauth";

const validateReleaseOAuth = async ({
  env = process.env,
  configPath,
  fetcher = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
}: {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} = {}) => {
  const clientSecret = env.NAPS_GSC_CLIENT_SECRET;
  if (!clientSecret?.trim()) {
    throw new Error("NAPS_GSC_CLIENT_SECRET is required to validate and build release binaries.");
  }
  if (env.NAPS_GSC_CLIENT_ID && env.NAPS_GSC_CLIENT_ID !== BUILT_IN_GOOGLE_CLIENT_ID) {
    throw new Error("NAPS_GSC_CLIENT_ID must match the bundled client ID for release validation.");
  }
  const resolved = await resolveCredentials({ env, path: configPath });
  if (!resolved) {
    throw new Error(
      "Release OAuth validation requires a local Search Console connection or NAPS_GSC_REFRESH_TOKEN. Run `naps-cli search-console connect` with the release client secret first.",
    );
  }
  try {
    await refreshAccessToken({
      resolved: { ...resolved, source: "environment" },
      force: true,
      clientId: BUILT_IN_GOOGLE_CLIENT_ID,
      clientSecret,
      fetcher,
    });
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_client") {
      throw new Error(
        "Google rejected the release OAuth client secret. Check NAPS_GSC_CLIENT_SECRET for the bundled client ID.",
      );
    }
    if (error instanceof GoogleOAuthError && error.code === "SEARCH_CONSOLE_REAUTH_REQUIRED") {
      throw new Error(
        "Release OAuth validation requires a fresh connection. Run `naps-cli search-console connect` with the release client secret, or replace NAPS_GSC_REFRESH_TOKEN.",
      );
    }
    throw new Error(
      "Release OAuth validation failed. Check Google connectivity and credentials, then retry.",
    );
  }
};

export { validateReleaseOAuth };
