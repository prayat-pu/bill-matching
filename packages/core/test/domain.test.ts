import { describe, expect, it } from "vitest";
import { classifyChannel, deriveYear, offStatementStatus, prefixOf, STATUS } from "../src/domain.ts";

describe("document number prefixes", () => {
  it("does not count a daily bill as monthly", () => {
    expect(prefixOf("RCD2026-0001", "2026")).toBe("RCD");
    expect(prefixOf("RC2026-0001", "2026")).toBe("RC");
  });

  it("derives the year from the data instead of hardcoding it", () => {
    expect(deriveYear(["RC2027-1", "RC2027-2", "RA2026-9"])).toBe("2027");
    expect(deriveYear([])).toBeNull();
  });
});

describe("payment channel", () => {
  it("lets a cancellation beat everything", () => {
    expect(classifyChannel("ธ.กรุงไทย", true)).toBe("ยกเลิกบิล");
  });

  it("picks the first matching channel", () => {
    expect(classifyChannel("โอนผ่าน ธ.กรุงไทย", false)).toBe("กรุงไทย");
    expect(classifyChannel("zuzu จ่าย ณ ที่พัก", false)).toBe("ZUZUจ่าย ณ ที่พัก");
    expect(classifyChannel("เข้าระบบ ZUZU", false)).toBe("เข้าระบบZUZU");
    expect(classifyChannel("อะไรก็ไม่รู้", false)).toBeNull();
  });

  it("flags the payments that never reach the bank", () => {
    expect(offStatementStatus("เงินสด")).toBe(STATUS.cash);
    expect(offStatementStatus("zuzu จ่าย ณ ที่พัก")).toBe(STATUS.payAtProperty);
    expect(offStatementStatus("ธ.กรุงไทย")).toBeNull();
  });
});
