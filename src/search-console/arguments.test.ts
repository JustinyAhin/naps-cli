import { describe, expect, test } from "bun:test";
import { defaultDateRange, parseAnalyticsInput, validateDate } from "./arguments";

describe("Search Console arguments", () => {
  test("defaults to the previous 28 Pacific-time days", () => {
    expect(defaultDateRange({ now: new Date("2026-08-04T12:00:00Z") })).toEqual({
      startDate: "2026-07-07",
      endDate: "2026-08-03",
    });
  });

  test("rejects invalid dates and reversed ranges", () => {
    expect(() => validateDate({ value: "2026-02-30", name: "Date" })).toThrow(
      "Date is not a valid date",
    );
    expect(() =>
      parseAnalyticsInput({
        siteUrl: "sc-domain:example.com",
        startDate: "2026-08-03",
        endDate: "2026-08-01",
      }),
    ).toThrow("Start date must be on or before end date");
  });
});
