import { getKeywordsWebsite } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient, seoApiClientHeaders } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure, seoApiError } from "../cli/service-errors";

const command = async function (
  this: CliContext,
  flags: { location?: string; language?: string },
  url: string,
) {
  try {
    const { data, error, response } = await getKeywordsWebsite({
      client: getSeoApiClient(),
      headers: seoApiClientHeaders,
      query: {
        url,
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    if (error) return seoApiError({ error, response });
    const kws = (data?.keywords ?? [])
      .map((k) => ({
        keyword: k.keyword,
        volume: k.volume,
        rank: k.rank,
        mainIntent: k.mainIntent,
      }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
      .slice(0, 30);
    writeJson({ context: this, value: kws });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
