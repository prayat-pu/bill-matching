import { describe, expect, it } from "vitest";
import { parseReportRows, REPORT_HEADER_ROW_INDEX } from "../src/load/report.ts";
import { parseStatementRows, STATEMENT_HEADER_ROW_INDEX } from "../src/load/statement.ts";
import { mergeReceipts, parseReceiptRecords } from "../src/load/receipt.ts";
import { LoadError } from "../src/errors.ts";
import type { Row } from "../src/load/sheet.ts";

function pad(count: number): Row[] {
  return Array.from({ length: count }, () => [] as Row);
}

const reportRows: Row[] = [
  ...pad(REPORT_HEADER_ROW_INDEX),
  ["วันที่", "เลขที่เอกสาร", "ห้อง", "ชื่อลูกค้า", "รวมสุทธิ", "สถานะ"],
  ["03/12/2026", "RC2026-1", "A101", "นาย สมชาย", "8,100.00", ""],
  ["04/12/2026", "", "A102", "ไม่มีเลขที่", "1,000.00", ""],
  ["ไม่ใช่วันที่", "RC2026-3", "A103", "x", "1,000.00", ""],
];

describe("accounting report loader", () => {
  it("reads the header from the 5th row and parses Thai columns", () => {
    const { rows, rejected } = parseReportRows(reportRows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ id: "RC2026-1", room: "A101", totalPaymentDue: 810000 });
    expect(rows[0]!.date.toISOString().slice(0, 10)).toBe("2026-12-03");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("RC2026-3");
  });

  it("fails loudly when a required column is gone", () => {
    const broken: Row[] = [...pad(REPORT_HEADER_ROW_INDEX), ["วันที่", "ห้อง"]];
    expect(() => parseReportRows(broken)).toThrow(LoadError);
    expect(() => parseReportRows(broken)).toThrow(/เลขที่เอกสาร/);
  });
});

describe("bank statement loader", () => {
  const rows: Row[] = [
    ...pad(STATEMENT_HEADER_ROW_INDEX),
    ["วันที่/เวลา", "คำอธิบายรายละเอียด", "ฝาก"],
    ["03/12/2026\n14:05", "FROM MR. SOMCHAI", "8,100.00"],
    ["03/12/2026\n15:00", "ATM WITHDRAWAL", ""],
    ["เสีย", "FROM MISS. A", "500.00"],
  ];

  it("reads the header from the 8th row and drops non-deposits", () => {
    const { rows: out, rejected } = parseStatementRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0]!).toMatchObject({ amount: 810000, detail: "FROM MR. SOMCHAI" });
    expect(out[0]!.datetime!.toISOString()).toBe("2026-12-03T14:05:00.000Z");
    expect(out[1]!.datetime).toBeNull();
    expect(rejected).toHaveLength(1);
  });
});

describe("receipt records", () => {
  it("quarantines a bad record instead of losing it silently", () => {
    const { rows, rejected } = parseReceiptRecords([
      { id: "RC2026-1", date: "03/12/2026", time: "14:05", total_payment_due: "8,100.00", payment_info: "ธ.กรุงไทย" },
      { date: "03/12/2026" },
      { id: "RC2026-3", date: "ไม่รู้", time: "" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalPaymentDue).toBe(810000);
    expect(rejected).toHaveLength(2);
    expect(rejected[1]!.reason).toContain("RC2026-3");
  });

  it("dedupes history by id, last wins", () => {
    const first = parseReceiptRecords([{ id: "RC2026-1", date: "03/12/2026", time: "10:00" }]).rows;
    const second = parseReceiptRecords([{ id: "rc2026-1", date: "03/12/2026", time: "11:00" }]).rows;
    const merged = mergeReceipts(first, second);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.datetime.toISOString()).toBe("2026-12-03T11:00:00.000Z");
  });
});
