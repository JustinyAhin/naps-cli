import type { GetYoutubeTranscriptResponse } from "api-clients/seo-api/types.gen";
import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  type FetchParams,
} from "youtube-transcript-plus";
import { cliError } from "../cli/errors";

type Transcript = Omit<GetYoutubeTranscriptResponse, "cost">;

const decodeCaptionText = ({ text }: { text: string }) =>
  // YouTube caption XML can encode entities twice. The library decodes one layer.
  text.replace(/&(?:amp|lt|gt|quot|apos|#(?:x[\da-f]+|\d+));/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
    };
    if (!entity.startsWith("&#")) return named[entity.toLowerCase()] ?? entity;
    const hex = entity[2].toLowerCase() === "x";
    const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : entity;
  });

const getLocalYoutubeTranscript = async ({
  fetch,
  videoId,
  language,
}: {
  fetch: typeof globalThis.fetch;
  videoId: string;
  language?: string;
}): Promise<Transcript> => {
  const signal = AbortSignal.timeout(20_000);
  const empty: Transcript = {
    videoId,
    available: false,
    unsupportedLanguage: false,
    originLanguage: null,
    translateLanguage: null,
    text: "",
    segments: [],
  };
  const fetchCaptions = async ({ url, method, body, headers, lang, userAgent }: FetchParams) => {
    const response = await fetch(url, {
      method,
      body,
      signal,
      headers: {
        ...headers,
        ...(lang ? { "Accept-Language": lang } : {}),
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
    });
    if (response.status === 429 || response.status === 403)
      throw cliError({
        code: response.status === 429 ? "YOUTUBE_RATE_LIMITED" : "YOUTUBE_ACCESS_BLOCKED",
        message: "YouTube blocked the local caption request.",
        hint: "Try again later. Paid retrieval requires --provider dataforseo.",
      });
    if (response.status >= 500)
      throw cliError({
        code: "YOUTUBE_REQUEST_FAILED",
        message: "YouTube could not complete the caption request.",
        hint: "Try again later.",
      });
    return response;
  };
  try {
    const captions = await fetchTranscript(videoId, {
      lang: language,
      retries: 0,
      signal,
      videoFetch: fetchCaptions,
      playerFetch: fetchCaptions,
      transcriptFetch: fetchCaptions,
    });
    if (
      captions.length === 0 ||
      !captions.some((caption) => caption.text.trim()) ||
      captions.some(
        (caption) =>
          !Number.isFinite(caption.offset) ||
          !Number.isFinite(caption.duration) ||
          !Number.isFinite(caption.offset + caption.duration) ||
          caption.offset < 0 ||
          caption.duration < 0,
      )
    )
      throw cliError({
        code: "YOUTUBE_INVALID_RESPONSE",
        message: "YouTube returned invalid caption data.",
        hint: "Try again later. If the problem continues, update naps-cli.",
      });
    const segments = captions.map((caption) => ({
      text: decodeCaptionText({ text: caption.text }),
      startSeconds: caption.offset,
      endSeconds: caption.offset + caption.duration,
      durationSeconds: caption.duration,
    }));
    return {
      ...empty,
      available: true,
      originLanguage: captions[0].lang,
      text: segments.map((segment) => segment.text).join("\n"),
      segments,
    };
  } catch (error) {
    if (signal.aborted)
      throw cliError({
        code: "YOUTUBE_TIMEOUT",
        message: "The local caption request timed out.",
        hint: "Try again later.",
      });
    if (error instanceof YoutubeTranscriptDisabledError) return empty;
    if (error instanceof YoutubeTranscriptNotAvailableLanguageError)
      return { ...empty, unsupportedLanguage: true };
    if (error instanceof YoutubeTranscriptTooManyRequestError)
      throw cliError({
        code: "YOUTUBE_RATE_LIMITED",
        message: "YouTube blocked the local caption request.",
        hint: "Try again later. Paid retrieval requires --provider dataforseo.",
      });
    throw error;
  }
};

export { getLocalYoutubeTranscript };
