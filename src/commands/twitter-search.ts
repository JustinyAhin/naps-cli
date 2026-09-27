import { getTwitterApiToken, getXBearerToken } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { cliError } from "../cli/errors";
import { requestFailure } from "../cli/service-errors";

type TweetSearchProvider = "twitterapi" | "official";
type TweetSearchSort = "latest" | "top";
type OfficialArchive = "recent" | "all";

type NormalizedTweet = {
  id: string;
  url: string | null;
  text: string;
  createdAt: string | null;
  lang: string | null;
  provider: TweetSearchProvider;
  author: {
    id: string | null;
    username: string | null;
    name: string | null;
    url: string | null;
    verified: boolean | null;
    followers: number | null;
  };
  metrics: {
    replies: number | null;
    retweets: number | null;
    likes: number | null;
    quotes: number | null;
    views: number | null;
    bookmarks: number | null;
  };
  isReply: boolean | null;
  conversationId: string | null;
};

type TwitterApiUser = {
  id?: string;
  userName?: string;
  name?: string;
  url?: string;
  isBlueVerified?: boolean;
  followers?: number;
};

type TwitterApiTweet = {
  id?: string;
  url?: string;
  text?: string;
  retweetCount?: number;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  createdAt?: string;
  lang?: string;
  isReply?: boolean;
  conversationId?: string;
  author?: TwitterApiUser;
};

type TwitterApiSearchResponse = {
  tweets?: TwitterApiTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
};

type OfficialUser = {
  id?: string;
  username?: string;
  name?: string;
  url?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count?: number;
  };
};

type OfficialTweet = {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
    view_count?: number;
  };
};

type OfficialSearchResponse = {
  data?: OfficialTweet[];
  includes?: {
    users?: OfficialUser[];
  };
  meta?: {
    next_token?: string;
  };
};

type RequestJsonInput = {
  url: URL;
  headers: HeadersInit;
  provider: TweetSearchProvider;
};

type SearchInput = {
  query: string;
  limit: number;
  sort: TweetSearchSort;
  archive: OfficialArchive;
  startTime?: string;
  endTime?: string;
  sinceId?: string;
  untilId?: string;
};

class ProviderHttpError extends Error {
  provider: TweetSearchProvider;
  status: number;
  error: unknown;

  constructor({
    provider,
    status,
    error,
  }: {
    provider: TweetSearchProvider;
    status: number;
    error: unknown;
  }) {
    super(`${provider} request failed with status ${status}`);
    this.provider = provider;
    this.status = status;
    this.error = error;
  }
}

const optionalString = ({ value }: { value: unknown }) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const readResponseBody = async ({ response }: { response: Response }): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const requestJson = async <T>({ url, headers, provider }: RequestJsonInput): Promise<T> => {
  const response = await fetch(url, { headers });
  const body = await readResponseBody({ response });
  if (!response.ok) {
    throw new ProviderHttpError({ provider, status: response.status, error: body });
  }
  return body as T;
};

const toIsoDate = ({ value }: { value: string | undefined }) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

const tweetUrl = ({ id, username }: { id: string | undefined; username?: string | null }) => {
  if (!id) {
    return null;
  }
  return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;
};

const normalizeTwitterApiTweet = ({ tweet }: { tweet: TwitterApiTweet }): NormalizedTweet => {
  const id = tweet.id ?? "";
  const username = tweet.author?.userName ?? null;
  return {
    id,
    url: tweet.url ?? tweetUrl({ id, username }),
    text: tweet.text ?? "",
    createdAt: toIsoDate({ value: tweet.createdAt }),
    lang: tweet.lang || null,
    provider: "twitterapi",
    author: {
      id: tweet.author?.id ?? null,
      username,
      name: tweet.author?.name ?? null,
      url: tweet.author?.url ?? (username ? `https://x.com/${username}` : null),
      verified: tweet.author?.isBlueVerified ?? null,
      followers: tweet.author?.followers ?? null,
    },
    metrics: {
      replies: tweet.replyCount ?? null,
      retweets: tweet.retweetCount ?? null,
      likes: tweet.likeCount ?? null,
      quotes: tweet.quoteCount ?? null,
      views: tweet.viewCount ?? null,
      bookmarks: tweet.bookmarkCount ?? null,
    },
    isReply: tweet.isReply ?? null,
    conversationId: tweet.conversationId || null,
  };
};

const normalizeOfficialTweet = ({
  tweet,
  usersById,
}: {
  tweet: OfficialTweet;
  usersById: Map<string, OfficialUser>;
}): NormalizedTweet => {
  const id = tweet.id ?? "";
  const user = tweet.author_id ? usersById.get(tweet.author_id) : undefined;
  return {
    id,
    url: tweetUrl({ id, username: user?.username }),
    text: tweet.text ?? "",
    createdAt: tweet.created_at ?? null,
    lang: tweet.lang ?? null,
    provider: "official",
    author: {
      id: user?.id ?? tweet.author_id ?? null,
      username: user?.username ?? null,
      name: user?.name ?? null,
      url: user?.url ?? (user?.username ? `https://x.com/${user.username}` : null),
      verified: user?.verified ?? null,
      followers: user?.public_metrics?.followers_count ?? null,
    },
    metrics: {
      replies: tweet.public_metrics?.reply_count ?? null,
      retweets: tweet.public_metrics?.retweet_count ?? null,
      likes: tweet.public_metrics?.like_count ?? null,
      quotes: tweet.public_metrics?.quote_count ?? null,
      views: tweet.public_metrics?.impression_count ?? tweet.public_metrics?.view_count ?? null,
      bookmarks: tweet.public_metrics?.bookmark_count ?? null,
    },
    isReply: tweet.in_reply_to_user_id ? true : false,
    conversationId: tweet.conversation_id ?? null,
  };
};

const searchTwitterApi = async ({
  query,
  limit,
  sort,
}: SearchInput): Promise<NormalizedTweet[]> => {
  const tweets: NormalizedTweet[] = [];
  let cursor = "";
  let pagesFetched = 0;
  const maxPages = Math.ceil(limit / 20) + 10;

  while (tweets.length < limit && pagesFetched < maxPages) {
    const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
    url.searchParams.set("query", query);
    url.searchParams.set("queryType", sort === "latest" ? "Latest" : "Top");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const data = await requestJson<TwitterApiSearchResponse>({
      url,
      headers: { "x-api-key": getTwitterApiToken() },
      provider: "twitterapi",
    });
    const pageTweets = (data.tweets ?? []).map((tweet) => normalizeTwitterApiTweet({ tweet }));
    tweets.push(...pageTweets);
    pagesFetched += 1;

    if (!data.has_next_page || !data.next_cursor || data.next_cursor === cursor) {
      break;
    }
    cursor = data.next_cursor;
  }

  return tweets.slice(0, limit);
};

const searchOfficial = async ({
  query,
  limit,
  sort,
  archive,
  startTime,
  endTime,
  sinceId,
  untilId,
}: SearchInput): Promise<NormalizedTweet[]> => {
  const tweets: NormalizedTweet[] = [];
  let nextToken: string | undefined;
  const maxResults = archive === "all" ? 500 : 100;

  while (tweets.length < limit) {
    const remaining = limit - tweets.length;
    const pageSize = Math.min(maxResults, Math.max(10, remaining));
    const url = new URL(`https://api.x.com/2/tweets/search/${archive}`);
    url.searchParams.set("query", query);
    url.searchParams.set("max_results", String(pageSize));
    url.searchParams.set("sort_order", sort === "latest" ? "recency" : "relevancy");
    url.searchParams.set(
      "tweet.fields",
      [
        "author_id",
        "conversation_id",
        "created_at",
        "entities",
        "id",
        "in_reply_to_user_id",
        "lang",
        "public_metrics",
        "referenced_tweets",
        "text",
      ].join(","),
    );
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "id,username,name,url,verified,public_metrics");
    if (startTime) {
      url.searchParams.set("start_time", startTime);
    }
    if (endTime) {
      url.searchParams.set("end_time", endTime);
    }
    if (sinceId) {
      url.searchParams.set("since_id", sinceId);
    }
    if (untilId) {
      url.searchParams.set("until_id", untilId);
    }
    if (nextToken) {
      url.searchParams.set("next_token", nextToken);
    }

    const data = await requestJson<OfficialSearchResponse>({
      url,
      headers: { Authorization: `Bearer ${getXBearerToken()}` },
      provider: "official",
    });
    const usersById = new Map((data.includes?.users ?? []).map((user) => [user.id ?? "", user]));
    const pageTweets = (data.data ?? []).map((tweet) =>
      normalizeOfficialTweet({ tweet, usersById }),
    );
    tweets.push(...pageTweets);

    if (!data.meta?.next_token || data.meta.next_token === nextToken) {
      break;
    }
    nextToken = data.meta.next_token;
  }

  return tweets.slice(0, limit);
};

const providerError = ({ error }: { error: unknown }) => {
  if (error instanceof ProviderHttpError) {
    const details = { provider: error.provider, status: error.status };
    if (error.status === 401 || error.status === 403) {
      return cliError({
        code: error.provider === "official" ? "X_AUTH_FAILED" : "TWITTERAPI_AUTH_FAILED",
        message: `${error.provider === "official" ? "X API" : "TwitterAPI.io"} authentication failed.`,
        hint:
          error.provider === "official"
            ? "Check NAPS_CLI_X_BEARER_TOKEN or X_BEARER_TOKEN and try again."
            : "Check NAPS_CLI_TWITTERAPI_TOKEN or TWITTERAPI_API_KEY and try again.",
        details,
      });
    }
    if (error.status === 429) {
      return cliError({
        code: "TWITTER_RATE_LIMITED",
        message: "The Twitter/X request limit was reached.",
        hint: "Try again later.",
        details,
      });
    }
    if (error.provider === "twitterapi" && error.status === 402) {
      return cliError({
        code: "TWITTERAPI_INSUFFICIENT_CREDITS",
        message: "The TwitterAPI.io account has insufficient credits.",
        hint: "Recharge the TwitterAPI.io account and try again.",
        details,
      });
    }
    if (error.status === 400 || error.status === 422) {
      return cliError({
        code: "TWITTER_INVALID_REQUEST",
        message: "The Twitter/X provider rejected the request.",
        hint: "Check the query and command flags, then try again.",
        details,
      });
    }
    if (error.status >= 500) {
      return cliError({
        code: "TWITTER_PROVIDER_UNAVAILABLE",
        message: "The Twitter/X provider is temporarily unavailable.",
        hint: "Try again later.",
        details,
      });
    }
    return cliError({
      code: "TWITTER_REQUEST_FAILED",
      message: "The Twitter/X request failed.",
      hint: "Check the query and command flags, then try again.",
      details,
    });
  }
  return requestFailure({ error, service: "the Twitter/X provider", code: "TWITTER" });
};

type Flags = {
  provider: TweetSearchProvider;
  limit: number;
  sort: TweetSearchSort;
  archive: OfficialArchive;
  startTime?: string;
  endTime?: string;
  sinceId?: string;
  untilId?: string;
};

const command = async function (this: CliContext, flags: Flags, query: string) {
  const { provider, limit, sort, archive } = flags;
  const startTime = optionalString({ value: flags.startTime });
  const endTime = optionalString({ value: flags.endTime });
  const sinceId = optionalString({ value: flags.sinceId });
  const untilId = optionalString({ value: flags.untilId });

  if (
    provider === "twitterapi" &&
    (startTime || endTime || sinceId || untilId || archive !== "recent")
  ) {
    return cliError({
      code: "TWITTER_INVALID_ARGUMENTS",
      message: "Official-only filters cannot be used with --provider twitterapi.",
      hint: "Remove those flags or put time filters in the query with since_time:/until_time:.",
    });
  }

  try {
    const input = {
      query,
      limit,
      sort,
      archive,
      startTime,
      endTime,
      sinceId,
      untilId,
    };
    const tweets =
      provider === "twitterapi" ? await searchTwitterApi(input) : await searchOfficial(input);
    writeJson({ context: this, value: tweets });
  } catch (error) {
    return providerError({ error });
  }
};

export default command;
