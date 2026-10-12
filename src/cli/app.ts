import { buildInstallCommand, buildUninstallCommand } from "@stricli/auto-complete";
import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  help,
  proposeCompletions,
  version,
  type StricliIntegration,
} from "@stricli/core";
import packageJson from "../../package.json";
import type { CliContext } from "./context";
import { cliText } from "./errors";
import { boundedIntegerParser, budgetParser, stringParser } from "./parsers";

const locationBrief =
  'Location/country name (e.g. "Germany"). Run `naps-cli locations` to list valid values.';
const languageBrief =
  'Language name (e.g. "German"). Run `naps-cli locations` to see languages per country.';

const optionalStringFlag = ({ brief }: { brief: string }) => ({
  kind: "parsed" as const,
  parse: stringParser,
  optional: true as const,
  brief,
});

const stringArgument = ({ brief, placeholder }: { brief: string; placeholder?: string }) => ({
  parse: stringParser,
  brief,
  ...(placeholder ? { placeholder } : {}),
});

const redditSearch = buildCommand({
  loader: () => import("../commands/reddit-search"),
  parameters: {
    flags: {
      full: { kind: "boolean", optional: true, brief: "Return unshortened post text" },
      subreddit: optionalStringFlag({ brief: "Restrict search to a subreddit" }),
      sort: {
        kind: "enum",
        values: ["relevance", "hot", "top", "new"],
        default: "relevance",
        brief: "Sort order: relevance | hot | top | new",
      },
      time: {
        kind: "enum",
        values: ["all", "year", "month", "week"],
        default: "all",
        brief: "Time filter: all | year | month | week",
      },
      limit: {
        kind: "parsed",
        parse: boundedIntegerParser({ minimum: 1, maximum: 100 }),
        default: "20",
        brief: "Max results to fetch (1 to 100)",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [stringArgument({ brief: "Search keywords", placeholder: "query" })],
    },
  },
  docs: { brief: "Search Reddit posts by keywords" },
});

const redditPost = buildCommand({
  loader: () => import("../commands/reddit-post"),
  parameters: {
    flags: {
      full: {
        kind: "boolean",
        optional: true,
        brief: "Return unshortened text and all API-returned comments/replies",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [stringArgument({ brief: "Full Reddit post URL", placeholder: "url" })],
    },
  },
  docs: { brief: "Fetch a Reddit post with comments" },
});

const redditSubreddits = buildCommand({
  loader: () => import("../commands/reddit-subreddits"),
  parameters: {
    flags: {
      limit: {
        kind: "parsed",
        parse: boundedIntegerParser({ minimum: 1, maximum: 25 }),
        default: "10",
        brief: "Max subreddits to return (1 to 25)",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        stringArgument({ brief: "Topic to search for subreddits", placeholder: "query" }),
      ],
    },
  },
  docs: { brief: "Search subreddits by topic" },
});

const twitterSearch = buildCommand({
  loader: () => import("../commands/twitter-search"),
  parameters: {
    flags: {
      provider: {
        kind: "enum",
        values: ["twitterapi", "official"],
        default: "twitterapi",
        brief: "Provider: twitterapi | official",
      },
      limit: {
        kind: "parsed",
        parse: boundedIntegerParser({ minimum: 1, maximum: 100 }),
        default: "20",
        brief: "Max tweets to fetch (1 to 100)",
      },
      sort: {
        kind: "enum",
        values: ["latest", "top"],
        default: "latest",
        brief: "Sort order: latest | top",
      },
      archive: {
        kind: "enum",
        values: ["recent", "all"],
        default: "recent",
        brief: "Official X search archive: recent | all",
      },
      startTime: optionalStringFlag({
        brief: "Official X start_time filter, e.g. 2026-06-01T00:00:00Z",
      }),
      endTime: optionalStringFlag({
        brief: "Official X end_time filter, e.g. 2026-06-02T00:00:00Z",
      }),
      sinceId: optionalStringFlag({ brief: "Official X since_id filter" }),
      untilId: optionalStringFlag({ brief: "Official X until_id filter" }),
    },
    positional: {
      kind: "tuple",
      parameters: [stringArgument({ brief: "Search query", placeholder: "query" })],
    },
  },
  docs: { brief: "Search tweets using TwitterAPI.io or the official X API" },
});

const keywordFlags = {
  location: optionalStringFlag({ brief: locationBrief }),
  language: optionalStringFlag({ brief: languageBrief }),
  refresh: {
    kind: "boolean" as const,
    optional: true as const,
    brief: "Bypass successful research cache",
  },
  budget: {
    kind: "parsed" as const,
    parse: budgetParser,
    optional: true as const,
    placeholder: "<USD>",
    brief: "<USD> Maximum estimated provider spend (zero prevents new paid tasks)",
  },
  metadata: {
    kind: "boolean" as const,
    optional: true as const,
    brief: "Write cost, cache, and job metadata to stderr",
  },
};

const keywords = buildCommand({
  loader: () => import("../commands/keywords"),
  parameters: {
    flags: keywordFlags,
    positional: {
      kind: "tuple",
      parameters: [stringArgument({ brief: "Seed keyword", placeholder: "keyword" })],
    },
  },
  docs: { brief: "Get keyword suggestions, volume, competition, and intent" },
});

const keywordsBulk = buildCommand({
  loader: () => import("../commands/keywords-bulk"),
  parameters: {
    flags: {
      ...keywordFlags,
      requestId: {
        ...optionalStringFlag({
          brief: "<value> Resumable run ID; reuse with the same inputs to resume",
        }),
        placeholder: "<value>",
        parse: (input: string) => {
          if (!input.trim()) throw new SyntaxError("expected a nonempty request ID");
          return input;
        },
      },
    },
    positional: {
      kind: "array",
      parameter: stringArgument({
        brief: "Keywords to look up (quote multi-word keywords)",
        placeholder: "keyword",
      }),
      minimum: 1,
      maximum: 50,
    },
  },
  docs: { brief: "Bulk keyword lookup (pass each keyword as a separate argument, max 50)" },
});

const keywordsSerp = buildCommand({
  loader: () => import("../commands/keywords-serp"),
  parameters: {
    flags: keywordFlags,
    positional: {
      kind: "tuple",
      parameters: [stringArgument({ brief: "Keyword to inspect", placeholder: "keyword" })],
    },
  },
  docs: { brief: "Show pages ranking in Google for a keyword" },
});

const keywordsWebsite = buildCommand({
  loader: () => import("../commands/keywords-website"),
  parameters: {
    flags: keywordFlags,
    positional: {
      kind: "tuple",
      parameters: [stringArgument({ brief: "Website URL", placeholder: "url" })],
    },
  },
  docs: { brief: "Get keywords a website ranks for" },
});

const locations = buildCommand({
  loader: () => import("../commands/locations"),
  parameters: {
    flags: {
      country: optionalStringFlag({
        brief: 'Filter by country name or ISO code (e.g. "Germany" or "DE")',
      }),
    },
  },
  docs: {
    brief: "List supported locations and languages for keyword queries",
  },
});

const update = buildCommand({
  loader: () => import("../commands/update"),
  parameters: {},
  docs: { brief: "Update naps-cli to the latest release" },
});

const loadSearchConsoleCommand = async (
  name: "connectCommand" | "statusCommand" | "disconnectCommand" | "sitesCommand",
) => {
  const commands = await import("../commands/search-console");
  return commands[name];
};

const searchConsole = buildRouteMap({
  routes: {
    connect: buildCommand({
      loader: () => loadSearchConsoleCommand("connectCommand"),
      parameters: {},
      docs: { brief: "Connect a Google Search Console account on this machine" },
    }),
    status: buildCommand({
      loader: () => loadSearchConsoleCommand("statusCommand"),
      parameters: {},
      docs: { brief: "Check the local Search Console connection" },
    }),
    disconnect: buildCommand({
      loader: () => loadSearchConsoleCommand("disconnectCommand"),
      parameters: {},
      docs: { brief: "Revoke and remove the local Search Console connection" },
    }),
    sites: buildCommand({
      loader: () => loadSearchConsoleCommand("sitesCommand"),
      parameters: {},
      docs: {
        brief: "List properties available to the connected Google account",
      },
    }),
    analytics: buildCommand({
      loader: async () => (await import("../commands/search-console")).analyticsCommand,
      parameters: {
        flags: {
          startDate: optionalStringFlag({
            brief: "Inclusive start date in YYYY-MM-DD (defaults to 28 days before end date)",
          }),
          endDate: optionalStringFlag({
            brief: "Inclusive end date in YYYY-MM-DD (defaults to yesterday in Pacific time)",
          }),
          dimensions: {
            kind: "parsed",
            parse: stringParser,
            default: "query",
            brief: "Comma-separated dimensions: query,page,date,country,device,searchAppearance",
          },
          type: {
            kind: "enum",
            values: ["web", "image", "video", "news", "discover", "googleNews"],
            default: "web",
            brief: "Search type: web,image,video,news,discover,googleNews",
          },
          limit: {
            kind: "parsed",
            parse: boundedIntegerParser({ minimum: 1, maximum: 25_000 }),
            default: "25",
            brief: "Maximum rows from 1 to 25000",
          },
        },
        positional: {
          kind: "tuple",
          parameters: [
            stringArgument({
              brief: "Property URL, for example sc-domain:example.com or https://example.com/",
              placeholder: "site-url",
            }),
          ],
        },
      },
      docs: {
        brief: "Query clicks, impressions, CTR, and position for a property",
      },
    }),
  },
  docs: { brief: "Connect to Google Search Console and query property performance" },
});

const completion = buildRouteMap({
  routes: {
    install: buildInstallCommand<CliContext>("naps-cli", { bash: "naps-cli --complete" }),
    uninstall: buildUninstallCommand<CliContext>("naps-cli", { bash: true }),
  },
  docs: { brief: "Manage Bash tab completion" },
});

const root = buildRouteMap({
  routes: {
    "reddit-search": redditSearch,
    "reddit-post": redditPost,
    "reddit-subreddits": redditSubreddits,
    "twitter-search": twitterSearch,
    keywords,
    "keywords-bulk": keywordsBulk,
    "keywords-serp": keywordsSerp,
    "keywords-website": keywordsWebsite,
    locations,
    update,
    "search-console": searchConsole,
    completion,
  },
  docs: {
    brief: "Research CLI for Reddit, Twitter/X, SEO keyword data, and Google Search Console.",
  },
});

const splitCompletionLine = ({ line }: { line: string }) => {
  const inputs: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        inputs.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }

  if (current || /\s$/.test(line)) inputs.push(current);
  return inputs;
};

const completeIntegration: StricliIntegration<CliContext> = {
  flag: {
    brief: "Generate shell completion candidates",
    hidden: true,
    complete: false,
    async run(application, args) {
      const completionLine = this.process.env?.COMP_LINE;
      const inputs = completionLine
        ? splitCompletionLine({ line: completionLine }).slice(1)
        : [...args.result.unprocessedInputs];
      const context = this as CliContext;
      const proposals = await proposeCompletions(application, inputs, context);
      if (proposals.length > 0) {
        this.process.stdout.write(`${proposals.map(({ completion }) => completion).join("\n")}\n`);
      }
    },
  },
};

const documentation = {
  caseStyle: "convert-camel-to-kebab" as const,
  onlyRequiredInUsageLine: true,
  useAliasInUsageLine: false,
};

const app = buildApplication<CliContext>(
  root,
  {
    name: "naps-cli",
    scanner: {
      caseStyle: "allow-kebab-for-camel",
      allowArgumentEscapeSequence: true,
    },
    documentation,
    localization: { loadText: () => cliText },
    determineExitCode: () => 1,
  },
  {
    help: help({ brief: "Show help", formatting: documentation }),
    version: version({
      brief: "Show version",
      info: { currentVersion: packageJson.version },
    }),
    complete: completeIntegration,
  },
);

export { app, splitCompletionLine };
