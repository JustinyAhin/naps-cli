import { getLocations } from "api-clients/seo-api/sdk.gen";
import { getSeoApiClient, seoApiClientHeaders } from "../api";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { requestFailure, seoApiError } from "../cli/service-errors";

const command = async function (this: CliContext, flags: { country?: string }) {
  try {
    const { data, error, response } = await getLocations({
      client: getSeoApiClient(),
      headers: seoApiClientHeaders,
    });
    if (error) return seoApiError({ error, response });
    const all = data ?? [];
    const filtered = flags.country
      ? all.filter(
          (l) =>
            l.location_name.toLowerCase() === flags.country!.toLowerCase() ||
            l.country_iso_code.toLowerCase() === flags.country!.toLowerCase(),
        )
      : all;
    const out = filtered.map((l) => ({
      location: l.location_name,
      iso: l.country_iso_code,
      code: l.location_code,
      languages: l.available_languages.map((lang) => ({
        name: lang.language_name,
        code: lang.language_code,
        keywords: lang.keywords,
      })),
    }));
    writeJson({ context: this, value: out });
  } catch (error) {
    return requestFailure({ error, service: "the SEO API", code: "SEO" });
  }
};

export default command;
