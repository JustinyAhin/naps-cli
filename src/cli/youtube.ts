import type { InputParser } from "@stricli/core";

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeVideoParser: InputParser<string> = (input) => {
  const value = input.trim();
  if (videoIdPattern.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    if (url.username || url.password || url.port) throw new Error();
    const parts = url.pathname.split("/").filter(Boolean);
    const id =
      url.hostname === "youtu.be"
        ? parts.length === 1
          ? parts[0]
          : undefined
        : ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(
              url.hostname,
            )
          ? url.pathname === "/watch"
            ? url.searchParams.get("v")
            : parts.length === 2 && ["shorts", "live", "embed"].includes(parts[0])
              ? parts[1]
              : undefined
          : undefined;
    if (id && videoIdPattern.test(id)) return id;
  } catch {
    // Use the same error for malformed URLs and unsupported hosts.
  }
  throw new SyntaxError("expected a YouTube video URL or an 11-character video ID");
};

const youtubeLanguageCodeParser: InputParser<string> = (input) => {
  const value = input.trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value))
    throw new SyntaxError("expected a language code, such as en or pt-BR");
  return value;
};

export { youtubeVideoParser, youtubeLanguageCodeParser };
