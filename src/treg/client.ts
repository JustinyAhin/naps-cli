import { randomUUID } from "node:crypto";
import type { CliContext } from "../cli/context";
import { writeJson } from "../cli/context";
import { CliError, cliError } from "../cli/errors";
import type { TregFlags, TregMetadata, TregResponse } from "./types";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const textValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const invalidResponse = ({ metadata }: { metadata: TregMetadata }) =>
  cliError({
    code: "TREG_INVALID_RESPONSE",
    message: "Treg returned an unsupported response.",
    hint: "Check the call in Treg before repeating a paid request.",
    details: { treg: metadata },
  });

const requestTreg = async ({
  context,
  flags,
  endpoint,
  query,
  body,
}: {
  context: CliContext;
  flags: TregFlags;
  endpoint: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, string>;
}): Promise<TregResponse> => {
  const env = context.process.env ?? {};
  const token = env.NAPS_CLI_TREG_TOKEN?.trim() || env.TREG_TOKEN?.trim();
  if (!token) {
    throw cliError({
      code: "MISSING_TREG_TOKEN",
      message: "Treg authentication is not configured.",
      hint: "Set NAPS_CLI_TREG_TOKEN or TREG_TOKEN in your environment.",
    });
  }
  const requestId = flags.requestId ?? randomUUID();
  if (!/^[\x21-\x7e]{1,128}$/.test(requestId)) {
    throw cliError({
      code: "INVALID_ARGUMENTS",
      message: "The request ID must contain 1 to 128 visible ASCII characters.",
    });
  }
  if (!Number.isFinite(flags.budget) || flags.budget < 0) {
    throw cliError({
      code: "INVALID_ARGUMENTS",
      message: "The budget must be finite and nonnegative.",
    });
  }
  const url = new URL(`https://treg.to/call/${endpoint}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = new Headers({
    "X-Treg-Token": token,
    "X-Treg-Route-Max-Cost": String(flags.budget),
    "Idempotency-Key": requestId,
    Accept: "application/json",
  });
  const org = env.NAPS_CLI_TREG_ORG?.trim() || env.TREG_ORG?.trim();
  if (org) headers.set("X-Treg-Org", org);
  if (body) headers.set("Content-Type", "application/json");

  let metadata: TregMetadata = {
    endpoint,
    requestId,
    callId: null,
    sourceProvider: null,
    providerCostUsd: null,
  };
  try {
    const response = await context.fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const costHeader = response.headers.get("X-Treg-Cost-Micro");
    const micro = costHeader !== null && /^\d+$/.test(costHeader) ? Number(costHeader) : NaN;
    metadata = {
      ...metadata,
      callId: response.headers.get("X-Treg-Call-Id"),
      sourceProvider:
        response.headers.get("X-Treg-Served-By") ??
        (endpoint.startsWith("treg.") ? null : endpoint.split(".")[0]!),
      providerCostUsd: Number.isSafeInteger(micro) ? micro / 1_000_000 : null,
    };
    let data: Record<string, unknown> | null = null;
    try {
      data = asRecord(await response.json());
    } catch {
      if (response.ok) throw invalidResponse({ metadata });
    }
    if (!response.ok) {
      const budgetRejected =
        response.headers.get("X-Treg-Error") === "1" && data?.error === "route_max_cost";
      const [code, message, hint] = budgetRejected
        ? [
            "TREG_BUDGET_EXCEEDED",
            "The request exceeds the Treg budget.",
            "Increase --budget if you want to allow this request.",
          ]
        : response.status === 401 || response.status === 403
          ? [
              "TREG_ACCESS_DENIED",
              "Treg rejected access.",
              "Check your Treg token, team, and tool permissions.",
            ]
          : response.status === 402
            ? [
                "TREG_PAYMENT_REQUIRED",
                "Treg cannot fund this request.",
                "Check your Treg balance and spending limits.",
              ]
            : response.status === 429
              ? [
                  "TREG_RATE_LIMITED",
                  "Treg or its provider limited this request.",
                  "Check the call in Treg before trying again later.",
                ]
              : response.status >= 500
                ? [
                    "TREG_UNAVAILABLE",
                    "Treg or its provider is unavailable.",
                    "Check the call in Treg before repeating a paid request.",
                  ]
                : [
                    "TREG_REQUEST_REJECTED",
                    "Treg or its provider rejected the request.",
                    "Check the command inputs and Treg call record.",
                  ];
      throw cliError({ code, message, hint, details: { status: response.status, treg: metadata } });
    }
    if (response.status === 202) {
      throw cliError({
        code: "TREG_PENDING",
        message: "The provider has not completed the request.",
        hint: "Check the call in Treg. Do not start another paid request for the same task.",
        details: { treg: metadata },
      });
    }
    if (!data) throw invalidResponse({ metadata });
    if (
      data.success === false ||
      data.error ||
      (typeof data.status === "number" && data.status >= 400) ||
      data.status === "error" ||
      data.status === "failed"
    ) {
      throw cliError({
        code: "TREG_PROVIDER_ERROR",
        message: "The provider reported a failed request.",
        hint: "Check the inputs and call in Treg before repeating a paid request.",
        details: { treg: metadata },
      });
    }
    const route = asRecord(data._treg);
    metadata.sourceProvider ??= textValue(route?.served_by);
    return { data, metadata };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw cliError({
      code: "TREG_OUTCOME_UNKNOWN",
      message: "The Treg request did not complete on this machine.",
      hint: "Check Treg before retrying. Reuse --request-id with the same command and inputs to avoid duplicate charges.",
      details: { treg: metadata },
    });
  }
};

const writeTregResult = ({
  context,
  flags,
  response,
  result,
}: {
  context: CliContext;
  flags: TregFlags;
  response: TregResponse;
  result: unknown;
}) => {
  if (flags.metadata) {
    context.process.stderr.write(`${JSON.stringify({ treg: response.metadata }, null, 2)}\n`);
  }
  writeJson({
    context,
    value: {
      provider: "treg",
      endpoint: response.metadata.endpoint,
      sourceProvider: response.metadata.sourceProvider,
      requestId: response.metadata.requestId,
      retrievedAt: new Date().toISOString(),
      result,
    },
  });
};

export { asRecord, textValue, numberValue, invalidResponse, requestTreg, writeTregResult };
