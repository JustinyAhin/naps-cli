import { clearCredentials, resolveCredentials, saveCredentials } from "./config";
import type { ResolvedCredentials, SearchConsoleCredentials } from "./types";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOCATION_URL = "https://oauth2.googleapis.com/revoke";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const BUILT_IN_GOOGLE_CLIENT_ID =
  "41763337345-q0e2o7lgf29feft4taq0r7ifdqbgjihj.apps.googleusercontent.com";
declare const NAPS_BUILD_GOOGLE_CLIENT_SECRET: string;
const BUILT_IN_GOOGLE_CLIENT_SECRET =
  typeof NAPS_BUILD_GOOGLE_CLIENT_SECRET === "string" ? NAPS_BUILD_GOOGLE_CLIENT_SECRET : "";
const CALLBACK_PATH = "/oauth2/callback";

type OAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

class GoogleOAuthError extends Error {
  code: string;
  details?: unknown;

  constructor({ code, message, details }: { code: string; message: string; details?: unknown }) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const base64Url = ({ bytes }: { bytes: Uint8Array }) => Buffer.from(bytes).toString("base64url");

const randomUrlSafe = ({ bytes }: { bytes: number }) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url({ bytes: value });
};

const createPkce = async () => {
  const verifier = randomUrlSafe({ bytes: 64 });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url({ bytes: new Uint8Array(digest) }) };
};

const getGoogleClientId = ({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) => {
  const clientId = env.NAPS_GSC_CLIENT_ID ?? BUILT_IN_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new GoogleOAuthError({
      code: "MISSING_GOOGLE_CLIENT_ID",
      message:
        "Search Console OAuth is not configured in this build. Set NAPS_GSC_CLIENT_ID to a Google Desktop OAuth client ID.",
    });
  }
  return clientId;
};

const getGoogleClientSecret = ({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}) => {
  const clientSecret = env.NAPS_GSC_CLIENT_SECRET ?? BUILT_IN_GOOGLE_CLIENT_SECRET;
  if (!clientSecret) {
    throw new GoogleOAuthError({
      code: "MISSING_GOOGLE_CLIENT_SECRET",
      message:
        "Search Console OAuth is not configured in this build. Set NAPS_GSC_CLIENT_SECRET to the Google Desktop OAuth client secret.",
    });
  }
  return clientSecret;
};

const buildAuthorizationUrl = ({
  clientId,
  redirectUri,
  state,
  challenge,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}) => {
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SEARCH_CONSOLE_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  return url;
};

const readJson = async ({ response }: { response: Response }) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const requestToken = async ({
  body,
  fetcher = fetch,
}: {
  body: URLSearchParams;
  fetcher?: Fetcher;
}): Promise<OAuthTokenResponse> => {
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await readJson({ response })) as OAuthTokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new GoogleOAuthError({
      code: payload?.error ?? "TOKEN_EXCHANGE_FAILED",
      message: payload?.error_description ?? `Google token request failed (${response.status}).`,
      details: payload,
    });
  }
  return payload;
};

const exchangeAuthorizationCode = async ({
  clientId,
  clientSecret,
  code,
  verifier,
  redirectUri,
  fetcher = fetch,
}: {
  clientId: string;
  clientSecret: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetcher?: Fetcher;
}): Promise<SearchConsoleCredentials> => {
  const payload = await requestToken({
    fetcher,
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!payload.refresh_token) {
    throw new GoogleOAuthError({
      code: "MISSING_REFRESH_TOKEN",
      message: "Google did not return a refresh token. Revoke Naps access in Google and try again.",
    });
  }
  const now = Date.now();
  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    accessTokenExpiresAt: new Date(now + (payload.expires_in ?? 3600) * 1000).toISOString(),
    scope: payload.scope?.split(" ").filter(Boolean) ?? [SEARCH_CONSOLE_SCOPE],
    connectedAt: new Date(now).toISOString(),
  };
};

const refreshAccessToken = async ({
  resolved,
  force = false,
  clientId = getGoogleClientId(),
  clientSecret,
  fetcher = fetch,
  configPath,
}: {
  resolved: ResolvedCredentials;
  force?: boolean;
  clientId?: string;
  clientSecret?: string;
  fetcher?: Fetcher;
  configPath?: string;
}) => {
  const expiresAt = resolved.credentials.accessTokenExpiresAt
    ? new Date(resolved.credentials.accessTokenExpiresAt).getTime()
    : 0;
  if (
    !force &&
    resolved.credentials.accessToken &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000
  ) {
    return resolved.credentials.accessToken;
  }

  const resolvedClientSecret = clientSecret ?? getGoogleClientSecret();

  let payload: OAuthTokenResponse;
  try {
    payload = await requestToken({
      fetcher,
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: resolvedClientSecret,
        refresh_token: resolved.credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
      throw new GoogleOAuthError({
        code: "SEARCH_CONSOLE_REAUTH_REQUIRED",
        message:
          "Google access has expired or been revoked. Run `naps-cli search-console connect`.",
        details: error.details,
      });
    }
    throw error;
  }

  const updated: SearchConsoleCredentials = {
    ...resolved.credentials,
    refreshToken: payload.refresh_token ?? resolved.credentials.refreshToken,
    accessToken: payload.access_token,
    accessTokenExpiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    scope: payload.scope?.split(" ").filter(Boolean) ?? resolved.credentials.scope,
  };
  resolved.credentials = updated;
  if (resolved.source === "config") {
    await saveCredentials({ credentials: updated, path: configPath });
  }
  return payload.access_token!;
};

const openBrowser = ({ url }: { url: string }) => {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["rundll32.exe", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url];
  try {
    const subprocess = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    subprocess.unref();
    return true;
  } catch {
    return false;
  }
};

const successHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Naps connected</title></head><body><main><h1>Search Console connected</h1><p>You can close this tab and return to the terminal.</p></main></body></html>`;

const waitForAuthorizationCode = ({
  state,
  timeoutMs = 300_000,
}: {
  state: string;
  timeoutMs?: number;
}) => {
  let settle: ((result: { code: string; redirectUri: string }) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const result = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== CALLBACK_PATH) {
        return new Response("Not found", { status: 404 });
      }
      if (url.searchParams.get("state") !== state) {
        return new Response("Invalid OAuth state. Return to the terminal and try again.", {
          status: 400,
        });
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        fail?.(
          new GoogleOAuthError({
            code: oauthError,
            message:
              url.searchParams.get("error_description") ??
              "Google authorization was not completed.",
          }),
        );
        return new Response("Authorization was not completed. You can close this tab.", {
          status: 400,
        });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Missing authorization code.", { status: 400 });
      }
      settle?.({ code, redirectUri: `http://127.0.0.1:${server.port}${CALLBACK_PATH}` });
      return new Response(successHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });

  const timer = setTimeout(() => {
    fail?.(
      new GoogleOAuthError({
        code: "AUTHORIZATION_TIMEOUT",
        message: "Google authorization timed out after five minutes.",
      }),
    );
  }, timeoutMs);

  return {
    redirectUri: `http://127.0.0.1:${server.port}${CALLBACK_PATH}`,
    result: result.finally(() => {
      clearTimeout(timer);
      server.stop();
    }),
  };
};

const connectSearchConsole = async ({
  env = process.env,
  fetcher = fetch,
  configPath,
}: {
  env?: NodeJS.ProcessEnv;
  fetcher?: Fetcher;
  configPath?: string;
} = {}) => {
  if (env.NAPS_GSC_REFRESH_TOKEN) {
    throw new GoogleOAuthError({
      code: "ENVIRONMENT_CREDENTIAL",
      message: "Unset NAPS_GSC_REFRESH_TOKEN before creating a local Search Console connection.",
    });
  }
  const clientId = getGoogleClientId({ env });
  const clientSecret = getGoogleClientSecret({ env });
  const { verifier, challenge } = await createPkce();
  const state = randomUrlSafe({ bytes: 32 });
  const callback = waitForAuthorizationCode({ state });
  const authorizationUrl = buildAuthorizationUrl({
    clientId,
    redirectUri: callback.redirectUri,
    state,
    challenge,
  });

  console.error("Opening Google authorization in your browser...");
  console.error(`If it does not open, visit:\n${authorizationUrl.toString()}`);
  openBrowser({ url: authorizationUrl.toString() });

  const { code, redirectUri } = await callback.result;
  const credentials = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code,
    verifier,
    redirectUri,
    fetcher,
  });
  await saveCredentials({ credentials, path: configPath });
  return credentials;
};

const revokeToken = async ({ token, fetcher = fetch }: { token: string; fetcher?: Fetcher }) => {
  try {
    const response = await fetcher(GOOGLE_REVOCATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const disconnectSearchConsole = async ({
  fetcher = fetch,
  configPath,
  env = process.env,
}: {
  fetcher?: Fetcher;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const resolved = await resolveCredentials({ path: configPath, env });
  if (!resolved) return { disconnected: false, reason: "not_connected" as const };
  if (resolved.source === "environment") {
    throw new GoogleOAuthError({
      code: "ENVIRONMENT_CREDENTIAL",
      message:
        "Search Console uses NAPS_GSC_REFRESH_TOKEN. Remove that environment variable to disconnect.",
    });
  }

  const revoked = await revokeToken({ token: resolved.credentials.refreshToken, fetcher });
  await clearCredentials({ path: configPath });
  return { disconnected: true, revoked };
};

export {
  BUILT_IN_GOOGLE_CLIENT_ID,
  GoogleOAuthError,
  SEARCH_CONSOLE_SCOPE,
  buildAuthorizationUrl,
  connectSearchConsole,
  createPkce,
  disconnectSearchConsole,
  exchangeAuthorizationCode,
  getGoogleClientId,
  getGoogleClientSecret,
  refreshAccessToken,
  revokeToken,
};
