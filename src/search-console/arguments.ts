import type { AnalyticsInput, SearchConsoleDimension, SearchConsoleType } from "./types";

const DIMENSIONS = [
  "query",
  "page",
  "date",
  "country",
  "device",
  "searchAppearance",
] as const satisfies readonly SearchConsoleDimension[];
const SEARCH_TYPES = [
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
] as const satisfies readonly SearchConsoleType[];

class SearchConsoleArgumentError extends Error {}

const pacificDate = ({ date }: { date: Date }) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const shiftIsoDate = ({ value, days }: { value: string; days: number }) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
};

const defaultDateRange = ({ now = new Date() }: { now?: Date } = {}) => {
  const today = pacificDate({ date: now });
  const endDate = shiftIsoDate({ value: today, days: -1 });
  return { startDate: shiftIsoDate({ value: endDate, days: -27 }), endDate };
};

const validateDate = ({ value, name }: { value: string; name: string }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SearchConsoleArgumentError(`${name} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new SearchConsoleArgumentError(`${name} is not a valid date.`);
  }
  return value;
};

const parseDimensions = ({ value }: { value: string }) => {
  const dimensions = value
    .split(",")
    .map((dimension) => dimension.trim())
    .filter(Boolean);
  if (dimensions.length === 0) {
    throw new SearchConsoleArgumentError("At least one dimension is required.");
  }
  const invalid = dimensions.find(
    (dimension) => !DIMENSIONS.includes(dimension as SearchConsoleDimension),
  );
  if (invalid) {
    throw new SearchConsoleArgumentError(
      `Invalid dimension: ${invalid}. Expected one of: ${DIMENSIONS.join(", ")}.`,
    );
  }
  if (new Set(dimensions).size !== dimensions.length) {
    throw new SearchConsoleArgumentError("Dimensions cannot be repeated.");
  }
  return dimensions as SearchConsoleDimension[];
};

const parseSearchType = ({ value }: { value: string }) => {
  if (!SEARCH_TYPES.includes(value as SearchConsoleType)) {
    throw new SearchConsoleArgumentError(
      `Invalid search type: ${value}. Expected one of: ${SEARCH_TYPES.join(", ")}.`,
    );
  }
  return value as SearchConsoleType;
};

const parseLimit = ({ value }: { value: string }) => {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25_000) {
    throw new SearchConsoleArgumentError("Limit must be an integer from 1 to 25000.");
  }
  return limit;
};

const validateSiteUrl = ({ value }: { value: string }) => {
  if (value.startsWith("sc-domain:") && value.length > "sc-domain:".length) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // Fall through to the actionable error below.
  }
  throw new SearchConsoleArgumentError(
    "Site must be a Search Console property such as sc-domain:example.com or https://example.com/.",
  );
};

const parseAnalyticsInput = ({
  siteUrl,
  startDate,
  endDate,
  dimensions = "query",
  type = "web",
  limit = "25",
  now,
}: {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  dimensions?: string;
  type?: string;
  limit?: string;
  now?: Date;
}): AnalyticsInput => {
  const defaults = defaultDateRange({ now });
  const parsedStart = validateDate({ value: startDate ?? defaults.startDate, name: "Start date" });
  const parsedEnd = validateDate({ value: endDate ?? defaults.endDate, name: "End date" });
  if (parsedStart > parsedEnd) {
    throw new SearchConsoleArgumentError("Start date must be on or before end date.");
  }
  return {
    siteUrl: validateSiteUrl({ value: siteUrl }),
    startDate: parsedStart,
    endDate: parsedEnd,
    dimensions: parseDimensions({ value: dimensions }),
    type: parseSearchType({ value: type }),
    limit: parseLimit({ value: limit }),
  };
};

export {
  DIMENSIONS,
  SEARCH_TYPES,
  SearchConsoleArgumentError,
  defaultDateRange,
  parseAnalyticsInput,
  parseDimensions,
  parseLimit,
  parseSearchType,
  validateDate,
  validateSiteUrl,
};
