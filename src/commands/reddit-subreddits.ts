import { subredditsSearchRedditSubredditsSearchGet } from "api-clients/reddit-api/sdk.gen";
import { getRedditApiClient } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { redditApiError, requestFailure } from "../cli/service-errors";

const command = async function (this: CliContext, flags: { limit: number }, query: string) {
  try {
    const { data, error, response } = await subredditsSearchRedditSubredditsSearchGet({
      client: getRedditApiClient(),
      query: { q: query, limit: flags.limit },
    });
    if (error) return redditApiError({ error, response });
    const subs = (data?.subreddits ?? []).map((s) => ({
      name: s.name,
      subscribers: s.subscribers,
      description: s.description,
    }));
    writeJson({ context: this, value: subs });
  } catch (error) {
    return requestFailure({ error, service: "the Reddit service", code: "REDDIT" });
  }
};

export default command;
