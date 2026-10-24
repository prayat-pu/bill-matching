import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadReportFile } from "../src/load/report.ts";
import { loadStatementFile } from "../src/load/statement.ts";
import { deriveYear, prefixOf } from "../src/domain.ts";

const REPORT = new URL("../../../raw/report_residence_1-25.xlsx", import.meta.url).pathname;
const STATEMENT = new URL("../../../raw/statement_res_1-25.xlsx", import.meta.url).pathname;

const hasRaw = existsSync(REPORT) && existsSync(STATEMENT);

describe.skipIf(!hasRaw)("the real May 2026 files in raw/", () => {
  it("reads the accounting report", async () => {
    const { rows, rejected } = await loadReportFile(await readFile(REPORT));
    expect(rows.length).toBeGreaterThan(100);
    expect(rejected).toEqual([]);

    const first = rows[0]!;
    expect(first.id).toBe("RA202605000001");
    expect(first.date.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(first.totalPaymentDue).toBe(5000);
    expect(first.room).toBe("A101");
    expect(first.reportStatus).toBe("ชำระเงินแล้ว");

    const year = deriveYear(rows.map((r) => r.id))!;
    expect(year).toBe("2026");
    // Every document number must land in a known prefix bucket.
    expect(rows.filter((r) => prefixOf(r.id, year) === null)).toEqual([]);
  });

  it("reads the bank statement", async () => {
    const { rows, rejected } = await loadStatementFile(await readFile(STATEMENT));
    // The sheet's own footer says 765 deposits.
    expect(rows).toHaveLength(765);
    expect(rejected).toEqual([]);

    const first = rows[0]!;
    expect(first.amount).toBe(5000);
    expect(first.datetime!.toISOString()).toBe("2026-05-01T07:58:27.000Z");
    expect(first.detail).toContain("สิริวิชญ์");
    // The brought-forward balance row has no deposit and must be gone.
    expect(rows.some((r) => r.detail.includes("ยอดเงินคงเหลือยกมา"))).toBe(false);
    expect(rows.some((r) => r.amount === 102537000)).toBe(false);
  });
});
