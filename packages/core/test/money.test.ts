import { describe, expect, it } from "vitest";
import { amountsAgree, parseSatang, toBaht } from "../src/money.ts";

describe("parseSatang", () => {
  it("strips thousands commas", () => {
    expect(parseSatang("12,345.67")).toBe(1234567);
  });

  it("takes plain numbers", () => {
    expect(parseSatang(1234.5)).toBe(123450);
  });

  it("rejects empty and junk", () => {
    expect(parseSatang("")).toBeNull();
    expect(parseSatang("   ")).toBeNull();
    expect(parseSatang(null)).toBeNull();
    expect(parseSatang("-")).toBeNull();
  });

  it("keeps cents exact where floats would not", () => {
    expect(parseSatang("0.1")! + parseSatang("0.2")!).toBe(parseSatang("0.3"));
    expect(amountsAgree(parseSatang("8,100.00")!, parseSatang("8100")!)).toBe(true);
  });

  it("converts back to baht", () => {
    expect(toBaht(1234567)).toBe(12345.67);
  });
});
