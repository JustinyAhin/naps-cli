import { getYoutubeTranscript } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure } from "../cli/service-errors";
import { handleSeoResponse, seoResearchHeaders } from "./seo";
import type { SeoResearchFlags } from "./types";
import { getLocalYoutubeTranscript } from "../youtube/local-transcript";
import { cliError } from "../cli/errors";

type TranscriptFlags = SeoResearchFlags & {
  provider: "dataforseo" | "local";
  subtitlesLanguage?: string;
  translateLanguage?: string;
};

const command = async function (this: CliContext, flags: TranscriptFlags, videoId: string) {
  if (flags.provider === "local") {
    if (flags.translateLanguage || flags.location || flags.language)
      return cliError({
        code: "INVALID_ARGUMENTS",
        message:
          "The local provider does not support translation, location, or search language options.",
        hint: "Use --subtitles-language to select existing captions, or select --provider dataforseo for these options.",
      });
    let failure;
    try {
      const transcript = await getLocalYoutubeTranscript({
        fetch: this.fetch,
        videoId,
        language: flags.subtitlesLanguage,
      });
      writeJson({ context: this, value: transcript });
    } catch (error) {
      failure = requestFailure({ error, service: "YouTube", code: "YOUTUBE" });
    }
    if (flags.metadata) {
      const seo = { requestId: null, providerCostUsd: 0, metadata: { provider: "local" } };
      if (failure) failure.details = { ...failure.details, seo };
      else this.process.stderr.write(`${JSON.stringify({ seo })}\n`);
    }
    return failure;
  }
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
