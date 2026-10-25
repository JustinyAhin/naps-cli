import { cliError } from "../cli/errors";

const invalidInput = (message: string) => cliError({ code: "INVALID_ARGUMENTS", message });

const requiredText = (value: string): string => {
  const text = value.trim();
  if (!text) throw invalidInput("The input must not be empty.");
  return text;
};

const publicUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidInput("Use a valid public HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw invalidInput("Use a public HTTPS URL without credentials or a port.");
  }
  return url;
};

const linkedinUrl = ({
  value,
  kind,
}: {
  value: string;
  kind: "post" | "person" | "company";
}): string => {
  const url = publicUrl(requiredText(value));
  if (!/(^|\.)linkedin\.com$/.test(url.hostname)) throw invalidInput("Use a linkedin.com URL.");
  const valid =
    kind === "person"
      ? /^\/in\/[^/]+\/?$/.test(url.pathname)
      : kind === "company"
        ? /^\/company\/[^/]+\/?$/.test(url.pathname)
        : /^\/(posts\/[^/]+|feed\/update\/urn:li:(?:activity|share):\d+)\/?$/.test(url.pathname);
  if (!valid) throw invalidInput(`Use a LinkedIn ${kind} URL.`);
  url.search = "";
  url.hash = "";
  return url.toString();
};

const emailAddress = (value: string): string => {
  const email = requiredText(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalidInput("Use a valid email address.");
  return email;
};

const companyDomain = (value: string): string => {
  const domain = requiredText(value).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw invalidInput("Use a company domain, for example example.com.");
  }
  return domain;
};

const companyIdentity = (value: string): Record<string, string> => {
  const text = requiredText(value);
  if (!text.includes("://")) return { domain: companyDomain(text) };
  const url = publicUrl(text);
  if (/(^|\.)linkedin\.com$/.test(url.hostname))
    return { linkedin_url: linkedinUrl({ value: text, kind: "company" }) };
  companyDomain(url.hostname);
  url.search = "";
  url.hash = "";
  return { website: url.toString() };
};

const personIdentity = (value: string): Record<string, string> =>
  value.includes("://")
    ? { linkedin_url: linkedinUrl({ value, kind: "person" }) }
    : { email: emailAddress(value) };

const youtubeChannel = (value: string): Record<string, string> => {
  let channel = requiredText(value);
  if (channel.includes("://")) {
    const url = publicUrl(channel);
    if (!/^(www\.)?youtube\.com$/.test(url.hostname))
      throw invalidInput("Use a youtube.com channel URL.");
    const match = url.pathname.match(
      /^\/(?:channel\/(UC[A-Za-z0-9_-]{22})|(@[^/]+))(?:\/(?:videos|featured|shorts))?\/?$/,
    );
    if (!match) throw invalidInput("Use a YouTube @handle or /channel/ URL.");
    channel = match[1] ?? match[2]!;
  }
  if (/^UC[A-Za-z0-9_-]{22}$/.test(channel)) return { channelId: channel };
  const handle = channel.replace(/^@/, "");
  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(handle))
    throw invalidInput("Use a YouTube channel ID or @handle.");
  return { handle };
};

export {
  requiredText,
  linkedinUrl,
  emailAddress,
  companyDomain,
  companyIdentity,
  personIdentity,
  youtubeChannel,
};
