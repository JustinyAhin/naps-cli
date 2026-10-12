import { postKeywordsBulk } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure } from "../cli/service-errors";
import { handleSeoResponse, seoResearchHeaders } from "./seo";
import type { SeoBulkFlags } from "./types";

const command = async function (this: CliContext, flags: SeoBulkFlags, ...keywords: string[]) {
  try {
    const { data, error, response } = await postKeywordsBulk({
      client: getSeoApiClient(),
      headers: seoResearchHeaders(flags),
      body: {
        keywords: keywords.join("\n"),
        ...(flags.location ? { location_name: flags.location } : {}),
        ...(flags.language ? { language_name: flags.language } : {}),
      },
    });
    const failure = handleSeoResponse({ context: this, flags, error, response });
    if (failure) return failure;
    writeJson({ context: this, value: data });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
