import type { RedditComment } from "api-clients/reddit-api/types.gen";
import { getPostRedditPostGet } from "api-clients/reddit-api/sdk.gen";
import { getRedditApiClient, truncate } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { cliError } from "../cli/errors";
import { redditApiError, requestFailure } from "../cli/service-errors";

const isRedditPostUrl = ({ value }: { value: string }) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isRedditHost =
      hostname === "reddit.com" || hostname.endsWith(".reddit.com") || hostname === "redd.it";
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isRedditHost &&
      url.pathname !== "/"
    );
  } catch {
    return false;
  }
};

const formatComment = ({ comment, full }: { comment: RedditComment; full: boolean }): unknown => ({
  id: comment.id,
  author: comment.author,
  created_utc: comment.created_utc,
  parent_id: comment.parent_id,
  depth: comment.depth,
  is_submitter: comment.is_submitter,
  body: full ? comment.body : truncate({ value: comment.body, max: 500 }),
  body_truncated: !full && comment.body.length > 500,
  score: comment.score,
  replies_omitted: !full && (comment.replies?.length ?? 0) > 0,
  ...(full
    ? { replies: (comment.replies ?? []).map((reply) => formatComment({ comment: reply, full })) }
    : {}),
});

const command = async function (this: CliContext, flags: { full?: boolean }, url: string) {
  if (!isRedditPostUrl({ value: url })) {
    return cliError({
      code: "INVALID_REDDIT_URL",
      message: "Enter a full Reddit post URL.",
      hint: "Use a URL such as https://www.reddit.com/r/example/comments/post-id/title/.",
    });
  }
  try {
    const { data, error, response } = await getPostRedditPostGet({
      client: getRedditApiClient(),
      query: { url },
    });
    if (error) return redditApiError({ error, response });
    if (!data) {
      return cliError({
        code: "REDDIT_EMPTY_RESPONSE",
        message: "Reddit returned no post data.",
        hint: "Check that the post exists and is publicly accessible.",
      });
    }
    const full = flags.full ?? false;
    const comments = data.comments ?? [];
    const result = {
      id: data.post.id,
      author: data.post.author,
      subreddit: data.post.subreddit,
      permalink: data.post.permalink,
      created_utc: data.post.created_utc,
      num_comments: data.post.num_comments,
      title: data.post.title,
      selftext: full ? data.post.selftext : truncate({ value: data.post.selftext, max: 3000 }),
      selftext_truncated: !full && data.post.selftext.length > 3000,
      comments_truncated: !full && comments.length > 15,
      comments_complete: false,
      comments_scope: "API-returned comments only; Reddit more-comments are not expanded",
      comments: (full ? comments : comments.slice(0, 15)).map((comment) =>
        formatComment({ comment, full }),
      ),
    };
    writeJson({ context: this, value: result });
  } catch (error) {
    return requestFailure({ error, service: "the Reddit service", code: "REDDIT" });
  }
};

export { isRedditPostUrl };
export default command;
