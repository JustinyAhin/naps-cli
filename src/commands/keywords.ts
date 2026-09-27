import { getKeywordsSuggestions } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient, seoApiClientHeaders } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure, seoApiError } from "../cli/service-errors";

const command = async function (
  this: CliContext,
  flags: { location?: string; language?: string },
  keyword: string,
) {
  try {
    const { data, error, response } = await getKeywordsSuggestions({
      client: getSeoApiClient(),
      headers: seoApiClientHeaders,
      query: {
        keyword,
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    if (error) return seoApiError({ error, response });
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
