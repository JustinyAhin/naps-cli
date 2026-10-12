import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";

const command = function (this: CliContext) {
  writeJson({
    context: this,
    value: {
      guideUrl: "https://naps.sh/cli/agent.md",
      canonicalGuide: "docs/agents.md",
      instructions: [
        "Run naps-cli --help and naps-cli <command> --help for current commands and options.",
        "Inject NAPS_CLI_API_KEY through the runner's secret environment for SEO and enabled Reddit access. Never print credentials or put them in prompts.",
        "Parse stdout as JSON only on exit status zero. On failure, parse stderr JSON and inspect error.code and error.hint.",
        "Use focused queries. Bulk accepts up to 50 keywords; inspect every entry's error even on exit status zero.",
        "SEO --metadata writes cost, freshness, and job details to stderr without changing stdout. Unknown costs remain null.",
        "SEO --budget and --refresh require the updated service and gateway. Budgets use estimates, not guaranteed invoice caps.",
        "Bulk --request-id resumes the same inputs and locale. Refresh does not reset that run; use a new ID for intentional fresh research.",
        "Stop on SEO_AMBIGUOUS_PROVIDER_OUTCOME or an AMBIGUOUS_PROVIDER_OUTCOME bulk entry and request operator reconciliation. Do not retry, refresh, or change IDs to bypass held work.",
        "Twitter/X uses your provider key. Search Console requires Google OAuth setup and connects directly to Google.",
      ],
      examples: [
        "naps-cli keywords 'invoice software' --metadata",
        "naps-cli keywords 'invoice software' --refresh --metadata",
        "naps-cli keywords-bulk 'invoice software' 'bookkeeping' --budget 0.05 --request-id research-1 --metadata",
      ],
    },
  });
};

export default command;
