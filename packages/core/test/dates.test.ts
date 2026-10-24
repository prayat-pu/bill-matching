import { describe, expect, it } from "vitest";
import { dayKey, parseDayFirstDate, parseDayFirstDateTime, parseStatementDateTime } from "../src/dates.ts";

describe("day-first parsing", () => {
  it("reads DD/MM/YYYY, not MM/DD", () => {
    const d = parseDayFirstDate("03/12/2026")!;
    expect(d.getUTCDate()).toBe(3);
    expect(d.getUTCMonth()).toBe(11);
  });

  it("rejects an impossible day", () => {
    expect(parseDayFirstDate("31/02/2026")).toBeNull();
    expect(parseDayFirstDate("not a date")).toBeNull();
  });

  it("converts a Buddhist-era year", () => {
    expect(parseDayFirstDate("03/12/2569")!.getUTCFullYear()).toBe(2026);
  });

  it("joins date and time", () => {
    expect(parseDayFirstDateTime("03/12/2026", "14:05:09")!.toISOString()).toBe("2026-12-03T14:05:09.000Z");
  });

  it("splits the statement cell on its literal newline", () => {
    expect(parseStatementDateTime("03/12/2026\n14:05")!.toISOString()).toBe("2026-12-03T14:05:00.000Z");
  });

  it("keys by day only", () => {
    expect(dayKey(parseDayFirstDateTime("03/12/2026", "23:59")!)).toBe("2026-12-03");
  });
});
