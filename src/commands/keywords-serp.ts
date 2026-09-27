import { getKeywordsSerp } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient, seoApiClientHeaders, truncate } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure, seoApiError } from "../cli/service-errors";

const command = async function (
  this: CliContext,
  flags: { location?: string; language?: string },
  keyword: string,
) {
  try {
    const { data, error, response } = await getKeywordsSerp({
      client: getSeoApiClient(),
      headers: seoApiClientHeaders,
      query: {
        keyword,
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    if (error) return seoApiError({ error, response });
    const results = (data?.results ?? []).map((result) => ({
      rank: result.rank,
      title: result.title,
      domain: result.domain,
      url: result.url,
      description: truncate({ value: result.description, max: 240 }),
      breadcrumb: result.breadcrumb,
    }));
    writeJson({ context: this, value: results });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
