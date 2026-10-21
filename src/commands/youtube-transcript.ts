import { getYoutubeTranscript } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure } from "../cli/service-errors";
import { handleSeoResponse, seoResearchHeaders } from "./seo";
import type { SeoResearchFlags } from "./types";

const command = async function (
  this: CliContext,
  flags: SeoResearchFlags & { subtitlesLanguage?: string; translateLanguage?: string },
  videoId: string,
) {
  try {
    const { data, error, response } = await getYoutubeTranscript({
      client: getSeoApiClient(),
      headers: seoResearchHeaders(flags),
      query: {
        video_id: videoId,
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
        ...(flags.subtitlesLanguage ? { subtitles_language: flags.subtitlesLanguage } : {}),
        ...(flags.translateLanguage ? { translate_language: flags.translateLanguage } : {}),
      },
    });
    const failure = handleSeoResponse({ context: this, flags, error, response });
    if (failure) return failure;
    if (!data) throw new Error("Missing transcript response");
    const { cost: _cost, ...transcript } = data;
    writeJson({ context: this, value: transcript });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
