import { buildCommand } from "@stricli/core";
import { boundedIntegerParser, budgetParser, stringParser } from "./parsers";

const optionalText = (brief: string) => ({
  kind: "parsed" as const,
  parse: stringParser,
  optional: true as const,
  brief,
});

const tregFlags = {
  budget: {
    kind: "parsed" as const,
    parse: budgetParser,
    default: "0.05",
    brief: "<USD> Treg cost estimate limit for this call (default: 0.05)",
    placeholder: "<USD>",
  },
  metadata: {
    kind: "boolean" as const,
    optional: true as const,
    brief: "Write Treg cost and call metadata to stderr",
  },
  requestId: optionalText(
    "Reuse an ID with the same inputs to replay a request without another charge",
  ),
};

const positional = (brief: string) => ({
  kind: "tuple" as const,
  parameters: [{ parse: stringParser, brief }] as const,
});

const limitFlag = {
  kind: "parsed" as const,
  parse: boundedIntegerParser({ minimum: 1, maximum: 100 }),
  default: "20",
  brief: "Maximum rows to return from one provider page (1 to 100)",
};

const tregResearchRoutes = {
  "linkedin-search": buildCommand({
    loader: async () => (await import("../commands/treg-research")).linkedinSearchCommand,
    parameters: {
      flags: {
        ...tregFlags,
        limit: limitFlag,
        sort: {
          kind: "enum",
          values: ["relevance", "date"],
          default: "relevance",
          brief: "Post order: relevance | date",
        },
        time: {
          kind: "enum",
          values: ["1h", "24h", "week", "month", "3months", "6months", "year"],
          optional: true,
          brief: "Maximum post age",
        },
        page: {
          kind: "parsed",
          parse: boundedIntegerParser({ minimum: 1, maximum: 100 }),
          default: "1",
          brief: "Provider page (one page per call)",
        },
        paginationToken: optionalText("Token from the previous page, when returned"),
        author: optionalText("Filter by a LinkedIn person URL"),
        company: optionalText("Filter by a LinkedIn company URL"),
      },
      positional: positional(
        "Post search query (quoted phrases and Boolean operators are supported)",
      ),
    },
    docs: { brief: "Search public LinkedIn posts through Treg" },
  }),
  "linkedin-post": buildCommand({
    loader: async () => (await import("../commands/treg-research")).linkedinPostCommand,
    parameters: { flags: tregFlags, positional: positional("LinkedIn post URL") },
    docs: { brief: "Read a LinkedIn post with author, date, and engagement" },
  }),
  "company-lookup": buildCommand({
    loader: async () => (await import("../commands/treg-research")).companyLookupCommand,
    parameters: {
      flags: tregFlags,
      positional: positional("Company domain, website, or LinkedIn company URL"),
    },
    docs: { brief: "Look up company details through Treg" },
  }),
  "person-lookup": buildCommand({
    loader: async () => (await import("../commands/treg-research")).personLookupCommand,
    parameters: {
      flags: tregFlags,
      positional: positional("LinkedIn person URL or email address"),
    },
    docs: { brief: "Look up a person's professional profile through Treg" },
  }),
  "email-find": buildCommand({
    loader: async () => (await import("../commands/treg-research")).emailFindCommand,
    parameters: {
      flags: {
        ...tregFlags,
        name: optionalText("Full name (requires --domain)"),
        domain: optionalText("Company domain (requires --name)"),
        linkedinUrl: optionalText("LinkedIn person URL (alternative to name and domain)"),
      },
    },
    docs: { brief: "Find a work email through Treg" },
  }),
  "email-verify": buildCommand({
    loader: async () => (await import("../commands/treg-research")).emailVerifyCommand,
    parameters: { flags: tregFlags, positional: positional("Email address") },
    docs: { brief: "Check an email address through Treg" },
  }),
  "youtube-channel": buildCommand({
    loader: async () => (await import("../commands/treg-research")).youtubeChannelCommand,
    parameters: {
      flags: tregFlags,
      positional: positional("YouTube @handle, channel ID, or channel URL"),
    },
    docs: { brief: "Read public YouTube channel statistics through Treg" },
  }),
  "youtube-videos": buildCommand({
    loader: async () => (await import("../commands/treg-research")).youtubeVideosCommand,
    parameters: {
      flags: {
        ...tregFlags,
        limit: limitFlag,
        sort: {
          kind: "enum",
          values: ["latest", "popular"],
          default: "latest",
          brief: "Video order: latest | popular",
        },
        continuationToken: optionalText("Token from the previous provider page"),
      },
      positional: positional("YouTube @handle, channel ID, or channel URL"),
    },
    docs: { brief: "List a YouTube channel's videos through Treg" },
  }),
};

export { tregResearchRoutes };
