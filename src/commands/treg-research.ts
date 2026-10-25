import type { CliContext } from "../cli/context";
import {
  companyDomain,
  companyIdentity,
  emailAddress,
  linkedinUrl,
  personIdentity,
  requiredText,
  youtubeChannel,
} from "../treg/arguments";
import {
  asRecord,
  invalidResponse,
  numberValue,
  requestTreg,
  textValue,
  writeTregResult,
} from "../treg/client";
import type { TregFlags, TregResponse } from "../treg/types";
import { cliError } from "../cli/errors";

type LinkedinSearchFlags = TregFlags & {
  sort: "relevance" | "date";
  time?: "1h" | "24h" | "week" | "month" | "3months" | "6months" | "year";
  page: number;
  paginationToken?: string;
  author?: string;
  company?: string;
  limit: number;
};

type YoutubeVideosFlags = TregFlags & {
  sort: "latest" | "popular";
  continuationToken?: string;
  limit: number;
};

type EmailFindFlags = TregFlags & { name?: string; domain?: string; linkedinUrl?: string };

const linkedinPost = (value: Record<string, unknown>) => {
  const author = asRecord(value.author);
  const engagement = asRecord(value.engagement);
  const postedAt = asRecord(value.postedAt);
  return {
    id: textValue(value.id),
    url: textValue(value.linkedinUrl),
    text: textValue(value.content),
    publishedAt: textValue(postedAt?.date),
    author: {
      name: textValue(author?.name),
      url: textValue(author?.linkedinUrl),
      headline: textValue(author?.info),
      type: textValue(author?.type),
    },
    metrics: {
      likes: numberValue(engagement?.likes),
      comments: numberValue(engagement?.comments),
      shares: numberValue(engagement?.shares),
    },
  };
};

const recordRows = ({
  value,
  response,
}: {
  value: unknown;
  response: TregResponse;
}): Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.some((row) => !asRecord(row))) {
    throw invalidResponse({ metadata: response.metadata });
  }
  return value as Record<string, unknown>[];
};

const linkedinSearchCommand = async function (
  this: CliContext,
  flags: LinkedinSearchFlags,
  query: string,
) {
  const response = await requestTreg({
    context: this,
    flags,
    endpoint: "harvestapi.linkedin.post.search",
    query: {
      search: requiredText(query),
      sortBy: flags.sort,
      scrapePostedLimit: flags.time,
      page: flags.page,
      paginationToken: flags.paginationToken,
      profile: flags.author ? linkedinUrl({ value: flags.author, kind: "person" }) : undefined,
      company: flags.company ? linkedinUrl({ value: flags.company, kind: "company" }) : undefined,
    },
  });
  const rows = recordRows({ value: response.data.elements, response });
  const pagination = asRecord(response.data.pagination);
  writeTregResult({
    context: this,
    flags,
    response,
    result: {
      posts: rows.slice(0, flags.limit).map(linkedinPost),
      pagination: {
        page: numberValue(pagination?.pageNumber),
        totalPages: numberValue(pagination?.totalPages),
        totalResults: numberValue(pagination?.totalResultCount),
        nextToken:
          textValue(pagination?.paginationToken) ?? textValue(response.data.paginationToken),
      },
      fetched: rows.length,
      truncated: rows.length > flags.limit,
    },
  });
};

const linkedinPostCommand = async function (this: CliContext, flags: TregFlags, url: string) {
  const response = await requestTreg({
    context: this,
    flags,
    endpoint: "harvestapi.linkedin.post.get",
    query: { url: linkedinUrl({ value: url, kind: "post" }) },
  });
  const post = asRecord(response.data.element);
  if (response.data.element !== null && !post)
    throw invalidResponse({ metadata: response.metadata });
  writeTregResult({ context: this, flags, response, result: post ? linkedinPost(post) : null });
};

const lookup = async ({
  context,
  flags,
  endpoint,
  body,
}: {
  context: CliContext;
  flags: TregFlags;
  endpoint: string;
  body: Record<string, string>;
}) => {
  const response = await requestTreg({ context, flags, endpoint, body });
  if (
    !("output" in response.data) ||
    (response.data.output !== null && !asRecord(response.data.output))
  ) {
    throw invalidResponse({ metadata: response.metadata });
  }
  writeTregResult({ context, flags, response, result: response.data.output });
};

const companyLookupCommand = async function (this: CliContext, flags: TregFlags, identity: string) {
  await lookup({
    context: this,
    flags,
    endpoint: "treg.companies.enrich",
    body: companyIdentity(identity),
  });
};

const personLookupCommand = async function (this: CliContext, flags: TregFlags, identity: string) {
  await lookup({
    context: this,
    flags,
    endpoint: "treg.people.enrich",
    body: personIdentity(identity),
  });
};

const emailFindCommand = async function (this: CliContext, flags: EmailFindFlags) {
  const byName = flags.name !== undefined || flags.domain !== undefined;
  if (
    (!flags.linkedinUrl && !byName) ||
    (flags.linkedinUrl && byName) ||
    (byName && (!flags.name || !flags.domain))
  ) {
    throw cliError({
      code: "INVALID_ARGUMENTS",
      message: "Use --linkedin-url, or use --name and --domain together.",
    });
  }
  const body: Record<string, string> = flags.linkedinUrl
    ? { linkedin_url: linkedinUrl({ value: flags.linkedinUrl, kind: "person" }) }
    : { full_name: requiredText(flags.name!), domain: companyDomain(flags.domain!) };
  await lookup({ context: this, flags, endpoint: "treg.people.email.find", body });
};

const emailVerifyCommand = async function (this: CliContext, flags: TregFlags, email: string) {
  await lookup({
    context: this,
    flags,
    endpoint: "treg.people.email.verify",
    body: { email: emailAddress(email) },
  });
};

const youtubeChannelCommand = async function (this: CliContext, flags: TregFlags, channel: string) {
  const response = await requestTreg({
    context: this,
    flags,
    endpoint: "scrapecreators.youtube.channel.profile",
    query: youtubeChannel(channel),
  });
  const data = response.data;
  if (!textValue(data.channelId)) throw invalidResponse({ metadata: response.metadata });
  writeTregResult({
    context: this,
    flags,
    response,
    result: {
      id: textValue(data.channelId),
      url: textValue(data.channel),
      handle: textValue(data.handle) === "@undefined" ? null : textValue(data.handle),
      name: textValue(data.name),
      description: textValue(data.description),
      subscribers: numberValue(data.subscriberCount),
      views: numberValue(data.viewCount),
      videos: numberValue(data.videoCount),
      verified: typeof data.isVerified === "boolean" ? data.isVerified : null,
    },
  });
};

const youtubeVideosCommand = async function (
  this: CliContext,
  flags: YoutubeVideosFlags,
  channel: string,
) {
  const response = await requestTreg({
    context: this,
    flags,
    endpoint: "scrapecreators.x.v1-youtube-channel-videos",
    query: {
      ...youtubeChannel(channel),
      sort: flags.sort,
      continuationToken: flags.continuationToken,
    },
  });
  const rows = recordRows({ value: response.data.videos, response });
  writeTregResult({
    context: this,
    flags,
    response,
    result: {
      videos: rows.slice(0, flags.limit),
      continuationToken: textValue(response.data.continuationToken),
      fetched: rows.length,
      truncated: rows.length > flags.limit,
    },
  });
};

export {
  linkedinSearchCommand,
  linkedinPostCommand,
  companyLookupCommand,
  personLookupCommand,
  emailFindCommand,
  emailVerifyCommand,
  youtubeChannelCommand,
  youtubeVideosCommand,
};
