import { describe, expect, test } from "bun:test";
import { normalizeError } from "./errors";

describe("CLI errors", () => {
  test("sanitizes unknown exceptions", () => {
    expect(normalizeError({ error: new Error("secret upstream response") })).toMatchObject({
      code: "UNEXPECTED_ERROR",
      message: "An unexpected error occurred.",
    });
  });
});
