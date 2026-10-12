import type { InputParser } from "@stricli/core";

const stringParser: InputParser<string> = (input) => input;

const budgetParser: InputParser<number> = (input) => {
  const value = Number(input);
  if (input.trim() === "" || !Number.isFinite(value) || value < 0) {
    throw new SyntaxError("expected a nonnegative finite USD amount");
  }
  return value;
};

const positiveIntegerParser: InputParser<number> = (input) => {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1) {
    throw new SyntaxError("expected a positive integer");
  }
  return value;
};

const boundedIntegerParser = ({ minimum, maximum }: { minimum: number; maximum: number }) => {
  const parser: InputParser<number> = (input) => {
    const value = Number(input);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new SyntaxError(`expected an integer from ${minimum} to ${maximum}`);
    }
    return value;
  };
  return parser;
};

export { boundedIntegerParser, budgetParser, positiveIntegerParser, stringParser };
