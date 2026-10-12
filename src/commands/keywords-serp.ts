import { getKeywordsSerp } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient, truncate } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure } from "../cli/service-errors";
import { handleSeoResponse, seoResearchHeaders } from "./seo";
import type { SeoResearchFlags } from "./types";

const command = async function (this: CliContext, flags: SeoResearchFlags, keyword: string) {
  try {
    const { data, error, response } = await getKeywordsSerp({
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
