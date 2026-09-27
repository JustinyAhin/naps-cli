import { searchRedditSearchGet } from "api-clients/reddit-api/sdk.gen";
import { getRedditApiClient, truncate } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { redditApiError, requestFailure } from "../cli/service-errors";

type Flags = {
  subreddit?: string;
  sort: "relevance" | "hot" | "top" | "new";
  time: "all" | "year" | "month" | "week";
  limit: number;
  full?: boolean;
};

const command = async function (this: CliContext, flags: Flags, query: string) {
  try {
    const { data, error, response } = await searchRedditSearchGet({
      client: getRedditApiClient(),
      query: {
        keywords: query,
        sort: flags.sort,
        t: flags.time,
        limit: flags.limit,
        ...(flags.subreddit ? { subreddit: flags.subreddit } : {}),
      },
    });
    if (error) return redditApiError({ error, response });
    const posts = (data?.posts ?? []).slice(0, flags.limit).map((p) => ({
      id: p.id,
      author: p.author,
      created_utc: p.created_utc,
      num_comments: p.num_comments,
      title: p.title,
      subreddit: p.subreddit,
      score: p.score,
      selftext: flags.full ? p.selftext : truncate({ value: p.selftext, max: 600 }),
      selftext_truncated: !flags.full && p.selftext.length > 600,
      permalink: p.permalink,
    }));
    writeJson({ context: this, value: posts });
  } catch (error) {
    return requestFailure({ error, service: "the Reddit service", code: "REDDIT" });
  }
};

export default command;
