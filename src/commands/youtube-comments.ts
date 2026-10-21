import { getYoutubeComments } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure } from "../cli/service-errors";
import { handleSeoResponse, seoResearchHeaders } from "./seo";
import type { SeoResearchFlags } from "./types";

const command = async function (this: CliContext, flags: SeoResearchFlags, videoId: string) {
  try {
    const { data, error, response } = await getYoutubeComments({
      client: getSeoApiClient(),
      headers: seoResearchHeaders(flags),
      query: {
        video_id: videoId,
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    const failure = handleSeoResponse({ context: this, flags, error, response });
    if (failure) return failure;
    writeJson({
      context: this,
      value: {
        videoId: data?.videoId ?? videoId,
        title: data?.title ?? null,
        totalComments: data?.totalComments ?? null,
        comments: data?.comments ?? [],
      },
    });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
