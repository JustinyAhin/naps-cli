import type { CliContext } from "../cli/context";
import { writeJson, writeWarning } from "../cli/context";
import { cliError, unexpectedError } from "../cli/errors";
import { SearchConsoleArgumentError, parseAnalyticsInput } from "../search-console/arguments";
import {
  SearchConsoleApiError,
  getConnectionStatus,
  listSites,
  queryAnalytics,
} from "../search-console/client";
import { SearchConsoleConfigError, getConfigPath } from "../search-console/config";
import {
  GoogleOAuthError,
  connectSearchConsole,
  disconnectSearchConsole,
} from "../search-console/oauth";

type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";

type AnalyticsFlags = {
  startDate?: string;
  endDate?: string;
  dimensions: string;
  type: SearchType;
  limit: number;
};

const searchConsoleError = ({ error }: { error: unknown }) => {
  if (error instanceof SearchConsoleArgumentError) {
    return cliError({
      code: "SEARCH_CONSOLE_INVALID_ARGUMENT",
      message: error.message,
      hint: "Check the command arguments and try again.",
    });
  }
  if (error instanceof SearchConsoleConfigError) {
    return cliError({
      code: "SEARCH_CONSOLE_CONFIG_ERROR",
      message: error.message,
      hint: "Fix or remove the local Naps config, then try again.",
    });
  }
  if (error instanceof GoogleOAuthError || error instanceof SearchConsoleApiError) {
    const hint =
      error.code === "SEARCH_CONSOLE_RATE_LIMITED"
        ? "Try again later."
        : error.code === "SEARCH_CONSOLE_REQUEST_FAILED"
          ? "Check your connection and try again."
          : undefined;
    return cliError({ code: error.code, message: error.message, ...(hint ? { hint } : {}) });
  }
  return unexpectedError();
};

const connectCommand = async function (this: CliContext) {
  try {
    const credentials = await connectSearchConsole();
    writeJson({
      context: this,
      value: {
        connected: true,
        connectedAt: credentials.connectedAt,
        scope: credentials.scope,
        configPath: getConfigPath(),
      },
    });
  } catch (error) {
    return searchConsoleError({ error });
  }
};

const statusCommand = async function (this: CliContext) {
  try {
    writeJson({ context: this, value: await getConnectionStatus() });
  } catch (error) {
    return searchConsoleError({ error });
  }
};

const disconnectCommand = async function (this: CliContext) {
  try {
    const result = await disconnectSearchConsole();
    if (result.disconnected && !result.revoked) {
      writeWarning({
        context: this,
        message:
          "The local credential was removed, but Google could not confirm remote revocation.",
      });
    }
    writeJson({ context: this, value: result });
  } catch (error) {
    return searchConsoleError({ error });
  }
};

const sitesCommand = async function (this: CliContext) {
  try {
    writeJson({ context: this, value: await listSites() });
  } catch (error) {
    return searchConsoleError({ error });
  }
};

const analyticsCommand = async function (this: CliContext, flags: AnalyticsFlags, siteUrl: string) {
  try {
    const input = parseAnalyticsInput({
      siteUrl,
      startDate: flags.startDate,
      endDate: flags.endDate,
      dimensions: flags.dimensions,
      type: flags.type,
      limit: String(flags.limit),
    });
    writeJson({ context: this, value: await queryAnalytics({ input }) });
  } catch (error) {
    return searchConsoleError({ error });
  }
};

export {
  analyticsCommand,
  connectCommand,
  disconnectCommand,
  searchConsoleError,
  sitesCommand,
  statusCommand,
};
