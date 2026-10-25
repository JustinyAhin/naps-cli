import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";

const command = function (this: CliContext) {
  writeJson({
    context: this,
    value: {
      guideUrl: "https://naps.sh/cli/agent.md",
      canonicalGuide: "docs/agents.md",
      instructions: [
        "Run naps-cli <command> --help for command options.",
        "Set NAPS_CLI_API_KEY in the agent's environment for SEO, DataForSEO YouTube requests, and enabled Reddit access. Keep credentials out of prompts and output.",
        "When the exit status is zero, read stdout JSON. On failure, read stderr JSON. Use error.code and error.hint.",
        "Bulk accepts 1–50 keywords. Read error in each result, including when the command succeeds.",
        "SEO --metadata writes cost and cache data to stderr. Costs for saved results are zero. Unknown costs are null.",
        "SEO --budget and --refresh require the updated service and gateway. Actual charges can be higher than the estimate.",
        "Bulk --request-id resumes a run with the same inputs, location, and language. Refresh with the same ID still resumes it.",
        "For SEO_AMBIGUOUS_PROVIDER_OUTCOME or a bulk AMBIGUOUS_PROVIDER_OUTCOME, stop. Request operator reconciliation. Do not retry with refresh or a new ID.",
        "Twitter/X uses a provider key. Search Console uses Google OAuth and connects directly to Google.",
        "LinkedIn, company, person, email, and YouTube channel research use NAPS_CLI_TREG_TOKEN or TREG_TOKEN. Run each command with --help for inputs.",
        "Treg commands make one request with a default $0.05 cost estimate limit. Use --metadata for actual costs. Check TREG_OUTCOME_UNKNOWN or TREG_PENDING in Treg before retrying, and preserve --request-id with the same inputs.",
        "Keep each YouTube search result's type.",
        "For YouTube transcripts, try --provider local first. It needs no key or SEO units. Set --subtitles-language to the required language code. If omitted, local retrieval selects the first available track.",
        "Use transcript text only when available is true. Check originLanguage, text, and timed segments. Use DataForSEO for blocked or failed local requests, invalid results, or translation. Missing captions and caption errors can affect both providers.",
        "For paid fallback, select --provider dataforseo and set --budget 0.006. Omitting --provider uses DataForSEO. The CLI does not switch providers automatically.",
      ],
      examples: [
        "naps-cli keywords 'invoice software' --metadata",
        "naps-cli youtube-search 'invoice software' --metadata",
        "naps-cli youtube-comments Y8Wu4rSNJms --budget 0.002",
        "naps-cli youtube-transcript Y8Wu4rSNJms --provider local --subtitles-language en",
        "naps-cli youtube-transcript Y8Wu4rSNJms --provider dataforseo --subtitles-language en --budget 0.006 --metadata",
        "naps-cli keywords 'invoice software' --refresh --metadata",
        "naps-cli keywords-bulk 'invoice software' 'bookkeeping' --budget 0.05 --request-id research-1 --metadata",
      ],
    },
  });
};

export default command;
