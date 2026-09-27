type SearchConsoleCredentials = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  scope: string[];
  connectedAt: string;
};

type CredentialSource = "config" | "environment";

type ResolvedCredentials = {
  source: CredentialSource;
  credentials: SearchConsoleCredentials;
};

type SearchConsoleSite = {
  siteUrl: string;
  permissionLevel: string;
};

type SearchConsoleDimension = "query" | "page" | "date" | "country" | "device" | "searchAppearance";

type SearchConsoleType = "web" | "image" | "video" | "news" | "discover" | "googleNews";

type AnalyticsInput = {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: SearchConsoleDimension[];
  type: SearchConsoleType;
  limit: number;
};

type AnalyticsRow = Partial<Record<SearchConsoleDimension, string>> & {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type AnalyticsResult = {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: SearchConsoleDimension[];
  type: SearchConsoleType;
  rows: AnalyticsRow[];
  responseAggregationType: string | null;
};

export type {
  AnalyticsInput,
  AnalyticsResult,
  AnalyticsRow,
  CredentialSource,
  ResolvedCredentials,
  SearchConsoleCredentials,
  SearchConsoleDimension,
  SearchConsoleSite,
  SearchConsoleType,
};
