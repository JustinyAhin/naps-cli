import { CliError, cliError } from "./errors";

type ApiErrorInput = {
  error: unknown;
  response?: Response;
};

type SafeIssue = {
  path: string;
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCliQuotaExceeded = (error: unknown) =>
  isRecord(error) && error.error === "CLI_QUOTA_EXCEEDED";

const safeIssues = ({ error }: { error: unknown }): SafeIssue[] => {
  if (!isRecord(error)) return [];
  const candidates = Array.isArray(error.issues)
    ? error.issues
    : Array.isArray(error.detail)
      ? error.detail
      : [];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.msg === "string"
          ? candidate.msg
          : undefined;
    if (!message) return [];
    const path =
      typeof candidate.path === "string"
        ? candidate.path
        : Array.isArray(candidate.loc)
          ? candidate.loc.map(String).join(".")
          : "request";
    return [{ path, message }];
  });
};

const requestFailure = ({
  error,
  service,
  code,
}: {
  error: unknown;
  service: string;
  code: string;
}) => {
  if (error instanceof CliError) return error;
  if (error instanceof TypeError) {
    return cliError({
      code: `${code}_NETWORK_ERROR`,
      message: `Could not reach ${service}.`,
      hint: "Check your internet connection and try again.",
    });
  }
  return cliError({
    code: `${code}_REQUEST_FAILED`,
    message: `${service} request failed.`,
    hint: "Try again. If the problem continues, update naps-cli or report the issue.",
  });
};

const redditApiError = ({ error, response }: ApiErrorInput) => {
  if (!response) return requestFailure({ error, service: "the Reddit service", code: "REDDIT" });
  const status = response.status;
  if (status === 403 && isRecord(error) && error.error === "CLI_SERVICE_DISABLED") {
    return cliError({
      code: "REDDIT_NOT_ENABLED",
      message: "Hosted Reddit access is not enabled for this account.",
      hint: "See https://naps.sh/cli for beta availability.",
    });
  }
  if (status === 401 || status === 403) {
    return cliError({
      code: "REDDIT_AUTH_FAILED",
      message: "Reddit authentication failed.",
      hint: "Check NAPS_CLI_API_KEY or create a new key at https://naps.sh/cli.",
    });
  }
  if (status === 429) {
    if (isCliQuotaExceeded(error)) {
      return cliError({
        code: "NAPS_QUOTA_EXCEEDED",
        message: "Your daily Reddit allowance is used up.",
        hint: "Check usage at https://naps.sh/cli. Allowances reset at 00:00 UTC.",
      });
    }
    return cliError({
      code: "REDDIT_RATE_LIMITED",
      message: "Reddit's request limit was reached.",
      hint: "Try again later.",
    });
  }
  if (status === 422) {
    const issues = safeIssues({ error });
    return cliError({
      code: "REDDIT_INVALID_REQUEST",
      message: issues[0]?.message ?? "Reddit rejected the request.",
      hint: "Check the command arguments and try again.",
      ...(issues.length > 0 ? { details: { issues } } : {}),
    });
  }
  if (status >= 500) {
    return cliError({
      code: "REDDIT_API_UNAVAILABLE",
      message: "The Reddit service is temporarily unavailable.",
      hint: "Try again later.",
      details: { status },
    });
  }
  return cliError({
    code: "REDDIT_REQUEST_FAILED",
    message: "The Reddit request failed.",
    hint: "Check the command arguments and try again.",
    details: { status },
  });
};

const seoApiError = ({ error, response }: ApiErrorInput) => {
  if (!response) return requestFailure({ error, service: "the SEO API", code: "SEO" });
  const status = response.status;
  const value = isRecord(error) && typeof error.error === "string" ? error.error : undefined;
  const issues = safeIssues({ error });
  if (status === 401 || status === 403) {
    return cliError({
      code: "SEO_AUTH_FAILED",
      message: "SEO API authentication failed.",
      hint: "Check NAPS_CLI_API_KEY or create a new key at https://naps.sh/cli.",
    });
  }
  if (status === 402) {
    return cliError({
      code: "SEO_BUDGET_EXCEEDED",
      message: "The next paid task exceeds the research budget.",
      hint: "Increase --budget or use cached results without --refresh.",
    });
  }
  if (status === 409) {
    if (value === "AMBIGUOUS_PROVIDER_OUTCOME") {
      return cliError({
        code: "SEO_AMBIGUOUS_PROVIDER_OUTCOME",
        message: "The provider task's completion and cost are unknown. Research is held.",
        hint: "Do not retry, refresh, or choose a new request ID. Contact the service operator to reconcile the provider task.",
      });
    }
    return cliError({
      code: "SEO_REQUEST_ID_CONFLICT",
      message: "This request ID belongs to a different research payload.",
      hint: "Resume with the original inputs, or use a new --request-id for a different run.",
    });
  }
  if (status === 429) {
    if (isCliQuotaExceeded(error)) {
      return cliError({
        code: "NAPS_QUOTA_EXCEEDED",
        message: "Your daily SEO allowance is used up.",
        hint: "Check usage at https://naps.sh/cli. Allowances reset at 00:00 UTC.",
      });
    }
    return cliError({
      code: "SEO_RATE_LIMITED",
      message: "The SEO API request limit was reached.",
      hint: "Try again later.",
    });
  }
  if (value === "INVALID_INPUT") {
    return cliError({
      code: "SEO_INVALID_INPUT",
      message: issues[0]?.message ?? "The SEO API rejected the input.",
      hint: "Check the command arguments and try again.",
      ...(issues.length > 0 ? { details: { issues } } : {}),
    });
  }
  if (value === "INVALID_LOCATION_OR_LANGUAGE") {
    return cliError({
      code: "SEO_INVALID_LOCATION_OR_LANGUAGE",
      message:
        typeof error === "object" &&
        error &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "The location or language is not supported.",
      hint: "Run `naps-cli locations` to list supported values.",
    });
  }
  if (value === "MISSING_CLIENT_METADATA" || value === "INVALID_CLIENT_METADATA") {
    return cliError({
      code: "SEO_CLIENT_INCOMPATIBLE",
      message: "This naps-cli build is incompatible with the SEO API.",
      hint: "Update naps-cli and try again.",
    });
  }
  if (status >= 500) {
    return cliError({
      code: "SEO_API_UNAVAILABLE",
      message: "The SEO API is temporarily unavailable.",
      hint: "Try again later.",
      details: { status },
    });
  }
  return cliError({
    code: "SEO_REQUEST_FAILED",
    message: "The SEO API request failed.",
    hint: "Check the command arguments and try again.",
    details: { status },
  });
};

export { redditApiError, requestFailure, safeIssues, seoApiError };
