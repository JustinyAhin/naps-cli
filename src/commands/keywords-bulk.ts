import { postKeywordsBulk } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient, seoApiClientHeaders } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure, seoApiError } from "../cli/service-errors";

const command = async function (
  this: CliContext,
  flags: { location?: string; language?: string },
  ...keywords: string[]
) {
  try {
    const { data, error, response } = await postKeywordsBulk({
      client: getSeoApiClient(),
      headers: seoApiClientHeaders,
      body: {
        keywords: keywords.join("\n"),
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    if (error) return seoApiError({ error, response });
    writeJson({ context: this, value: data });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
