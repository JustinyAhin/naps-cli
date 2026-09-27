import { text_en, type ApplicationText } from "@stricli/core";

type CliErrorDetails = Record<string, unknown> | Array<unknown>;

type CliErrorOptions = {
  code: string;
  message: string;
  hint?: string;
  details?: CliErrorDetails;
};

class CliError extends Error {
  code: string;
  hint?: string;
  details?: CliErrorDetails;

  constructor({ code, message, hint, details }: CliErrorOptions) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

const cliError = (options: CliErrorOptions) => new CliError(options);

const errorEnvelope = ({ error }: { error: CliError }) => ({
  error: {
    code: error.code,
    message: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.details ? { details: error.details } : {}),
  },
});

const unexpectedError = () =>
  cliError({
    code: "UNEXPECTED_ERROR",
    message: "An unexpected error occurred.",
    hint: "Try again. If the problem continues, update naps-cli or report the issue.",
  });

const normalizeError = ({ error }: { error: unknown }) =>
  error instanceof CliError ? error : unexpectedError();

const formatException = (error: unknown) =>
  JSON.stringify(errorEnvelope({ error: normalizeError({ error }) }), null, 2);

const cliText: ApplicationText = {
  ...text_en,
  exceptionWhileRunningCommand: formatException,
  commandErrorResult: formatException,
};

export { CliError, cliError, cliText, errorEnvelope, normalizeError, unexpectedError };
export type { CliErrorDetails, CliErrorOptions };
