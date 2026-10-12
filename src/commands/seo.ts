import { seoApiClientHeaders } from "../api";
import type { CliContext } from "../cli/context";
import { seoApiError } from "../cli/service-errors";
import type { SeoBulkFlags, SeoResearchFlags } from "./types";

const seoResearchHeaders = (flags: SeoBulkFlags) => ({
  ...seoApiClientHeaders,
  ...(flags.refresh ? { "X-Naps-Refresh": "true" } : {}),
  ...(flags.budget !== undefined ? { "X-Naps-Max-Cost-USD": String(flags.budget) } : {}),
  ...(flags.requestId ? { "Idempotency-Key": flags.requestId } : {}),
});

const handleSeoResponse = ({
  context,
  flags,
  error,
  response,
}: {
  context: CliContext;
  flags: SeoResearchFlags;
  error: unknown;
  response?: Response;
}) => {
  const failure = error ? seoApiError({ error, response }) : undefined;
  if (flags.metadata) {
    const rawMetadata = response?.headers.get("X-Naps-Metadata") ?? null;
    let metadata: unknown = null;
    let metadataError: string | undefined;
    if (rawMetadata !== null) {
      try {
        metadata = JSON.parse(rawMetadata);
      } catch {
        metadataError = "INVALID_METADATA";
      }
    }
    const rawCost = response?.headers.get("X-Naps-Provider-Cost") ?? null;
    const cost = rawCost !== null && rawCost.trim() !== "" ? Number(rawCost) : NaN;
    const seo = {
      requestId: response?.headers.get("X-Naps-Request-Id") ?? null,
      providerCostUsd: Number.isFinite(cost) && cost >= 0 ? cost : null,
      metadata,
      ...(metadataError ? { metadataError } : {}),
    };
    if (failure) failure.details = { ...failure.details, seo };
    else context.process.stderr.write(`${JSON.stringify({ seo })}\n`);
  }
  return failure;
};

export { seoResearchHeaders, handleSeoResponse };
