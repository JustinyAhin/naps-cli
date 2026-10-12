import { getKeywordsSuggestions } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure } from "../cli/service-errors";
import { handleSeoResponse, seoResearchHeaders } from "./seo";
import type { SeoResearchFlags } from "./types";

const command = async function (this: CliContext, flags: SeoResearchFlags, keyword: string) {
  try {
    const { data, error, response } = await getKeywordsSuggestions({
      client: getSeoApiClient(),
      headers: seoResearchHeaders(flags),
      query: {
        keyword,
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    const failure = handleSeoResponse({ context: this, flags, error, response });
    if (failure) return failure;
    const kws = (data?.keywordSuggestions ?? [])
      .map((k) => ({
        keyword: k.keyword,
        volume: k.volume,
        competition: k.competition,
        mainIntent: k.mainIntent,
        difficulty: k.difficulty,
      }))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 25);
    writeJson({ context: this, value: kws });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
