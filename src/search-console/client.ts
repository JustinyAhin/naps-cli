import { resolveCredentials } from "./config";
import {
  GoogleOAuthError,
  getGoogleClientId,
  getGoogleClientSecret,
  refreshAccessToken,
} from "./oauth";
import type {
  AnalyticsInput,
  AnalyticsResult,
  AnalyticsRow,
  ResolvedCredentials,
  SearchConsoleSite,
} from "./types";

const SEARCH_CONSOLE_API_URL = "https://www.googleapis.com/webmasters/v3";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type SitesResponse = {
  siteEntry?: Array<{
    siteUrl?: string;
    permissionLevel?: string;
  }>;
};

type AnalyticsResponse = {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
  responseAggregationType?: string;
};

class SearchConsoleApiError extends Error {
  code: string;
  status?: number;
  details?: unknown;

  constructor({
    code,
    message,
    status,
    details,
  }: {
    code: string;
    message: string;
    status?: number;
    details?: unknown;
  }) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const readResponseBody = async ({ response }: { response: Response }) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const requireCredentials = async ({
  configPath,
  env,
}: {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const resolved = await resolveCredentials({ path: configPath, env });
  if (!resolved) {
    throw new GoogleOAuthError({
      code: "SEARCH_CONSOLE_NOT_CONNECTED",
      message: "Search Console is not connected. Run `naps-cli search-console connect`.",
    });
  }
  return resolved;
};

const authorizedRequest = async <T>({
  url,
  init,
  resolved,
  clientId,
  clientSecret,
  fetcher = fetch,
  configPath,
}: {
  url: string;
  init?: RequestInit;
  resolved: ResolvedCredentials;
  clientId: string;
  clientSecret: string;
  fetcher?: Fetcher;
  configPath?: string;
}): Promise<T> => {
  const request = async ({ forceRefresh }: { forceRefresh: boolean }) => {
    const accessToken = await refreshAccessToken({
      resolved,
      force: forceRefresh,
      clientId,
      clientSecret,
      fetcher,
      configPath,
    });
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetcher(url, { ...init, headers });
  };

  let response = await request({ forceRefresh: false });
  if (response.status === 401) {
    response = await request({ forceRefresh: true });
  }
  const body = await readResponseBody({ response });
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string; status?: string } } | null;
    const code =
      response.status === 429
        ? "SEARCH_CONSOLE_RATE_LIMITED"
        : (errorBody?.error?.status ?? "SEARCH_CONSOLE_REQUEST_FAILED");
    throw new SearchConsoleApiError({
      code,
      message: errorBody?.error?.message ?? `Search Console request failed (${response.status}).`,
      status: response.status,
      details: body,
    });
  }
  return body as T;
};

const listSites = async ({
  fetcher = fetch,
  configPath,
  env = process.env,
}: {
  fetcher?: Fetcher;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<SearchConsoleSite[]> => {
  const resolved = await requireCredentials({ configPath, env });
  const data = await authorizedRequest<SitesResponse>({
    url: `${SEARCH_CONSOLE_API_URL}/sites`,
    resolved,
    clientId: getGoogleClientId({ env }),
    clientSecret: getGoogleClientSecret({ env }),
    fetcher,
    configPath,
  });
  return (data.siteEntry ?? []).map((site) => ({
    siteUrl: site.siteUrl ?? "",
    permissionLevel: site.permissionLevel ?? "unknown",
  }));
};

const normalizeAnalyticsRows = ({
  response,
  dimensions,
}: {
  response: AnalyticsResponse;
  dimensions: AnalyticsInput["dimensions"];
}): AnalyticsRow[] =>
  (response.rows ?? []).map((row) => {
    const dimensionValues = Object.fromEntries(
      dimensions.map((dimension, index) => [dimension, row.keys?.[index] ?? ""]),
    ) as Partial<Record<AnalyticsInput["dimensions"][number], string>>;
    return {
      ...dimensionValues,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    };
  });

const queryAnalytics = async ({
  input,
  fetcher = fetch,
  configPath,
  env = process.env,
}: {
  input: AnalyticsInput;
  fetcher?: Fetcher;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AnalyticsResult> => {
  const resolved = await requireCredentials({ configPath, env });
  const response = await authorizedRequest<AnalyticsResponse>({
    url: `${SEARCH_CONSOLE_API_URL}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        type: input.type,
        rowLimit: input.limit,
        dataState: "final",
      }),
    },
    resolved,
    clientId: getGoogleClientId({ env }),
    clientSecret: getGoogleClientSecret({ env }),
    fetcher,
    configPath,
  });
  return {
    siteUrl: input.siteUrl,
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions: input.dimensions,
    type: input.type,
    rows: normalizeAnalyticsRows({ response, dimensions: input.dimensions }),
    responseAggregationType: response.responseAggregationType ?? null,
  };
};

const getConnectionStatus = async ({
  fetcher = fetch,
  configPath,
  env = process.env,
}: {
  fetcher?: Fetcher;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const resolved = await resolveCredentials({ path: configPath, env });
  if (!resolved) return { connected: false as const };

  const sites = await listSites({ fetcher, configPath, env });
  return {
    connected: true as const,
    valid: true,
    source: resolved.source,
    connectedAt: resolved.credentials.connectedAt,
    scope: resolved.credentials.scope,
    sites: sites.length,
  };
};

export {
  SearchConsoleApiError,
  getConnectionStatus,
  listSites,
  normalizeAnalyticsRows,
  queryAnalytics,
};
