import { describe, expect, test } from "bun:test";
import { defaultDateRange, parseAnalyticsInput, validateDate } from "./arguments";

describe("Search Console arguments", () => {
  test("defaults to the previous 28 Pacific-time days", () => {
    for (const [now, startDate, endDate] of [
      ["2026-08-04T12:00:00Z", "2026-07-07", "2026-08-03"],
      ["2026-08-04T00:00:00Z", "2026-07-06", "2026-08-02"],
      ["2026-03-08T07:59:59Z", "2026-02-07", "2026-03-06"],
      ["2026-03-08T08:00:00Z", "2026-02-08", "2026-03-07"],
      ["2026-03-09T06:59:59Z", "2026-02-08", "2026-03-07"],
      ["2026-03-09T07:00:00Z", "2026-02-09", "2026-03-08"],
    ]) {
      expect(defaultDateRange({ now: new Date(now!) })).toEqual({ startDate, endDate });
    }
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
