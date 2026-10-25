import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  STATUS,
  STATUS_OPTIONS,
  loadReportFile,
  loadStatementFile,
  parseReceiptRecords,
  reconcile,
} from "@bill/core";
import {
  INSERTED_HEADERS,
  SHEET_MATCHING,
  SHEET_STATEMENT,
  buildWorkbook,
  columnLetter,
  columnNumber,
  shiftMerges,
} from "../src/build.ts";

const RAW = new URL("../../../raw/", import.meta.url).pathname;
const files = {
  report: `${RAW}report_residence_1-25.xlsx`,
  statement: `${RAW}statement_res_1-25.xlsx`,
  receipts: `${RAW}extracted/receipts_residence_1-25.json`,
};
const hasRaw = Object.values(files).every((f) => existsSync(f));

describe("column maths", () => {
  it("counts past Z, both ways", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(columnLetter(32)).toBe("AF");
    expect(columnNumber("A")).toBe(1);
    expect(columnNumber("AF")).toBe(32);
  });

  it("shifts a merged range past the inserted columns", () => {
    expect(shiftMerges(["I4:N4", "O4:W4"], 2, 3)).toEqual(["L4:Q4", "R4:Z4"]);
    // A column before the insert point does not move.
    expect(shiftMerges(["A1:A2"], 2, 3)).toEqual(["A1:A2"]);
  });
});

describe.skipIf(!hasRaw)("the workbook built from the real May 2026 files", async () => {
  const report = await loadReportFile(await readFile(files.report));
  const statement = await loadStatementFile(await readFile(files.statement));
  const extracted = JSON.parse(await readFile(files.receipts, "utf8")) as { receipts: { bank?: string }[] };
  const receipts = parseReceiptRecords(extracted.receipts.map((r) => ({ ...r, payment_info: r.bank })));
  const result = reconcile({
    company: "44 Residence",
    report: report.rows,
    statement: statement.rows,
    receipts: receipts.rows,
  });

  const buffer = await buildWorkbook({
    result,
    report: report.sheet,
    statement: statement.sheet,
    company: "44 Residence",
  });
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet1 = out.getWorksheet(SHEET_MATCHING)!;
  const sheet2 = out.getWorksheet(SHEET_STATEMENT)!;

  it("has both sheets", () => {
    expect(out.worksheets.map((w) => w.name)).toEqual([SHEET_MATCHING, SHEET_STATEMENT]);
  });

  it("inserts the three columns at B, C and D, before เลขที่เอกสาร", () => {
    const header = sheet1.getRow(report.sheet.headerRow).values as unknown[];
    // ExcelJS pads index 0.
    expect(header[1]).toBe("วันที่");
    expect(header[2]).toBe(INSERTED_HEADERS[0]);
    expect(header[3]).toBe(INSERTED_HEADERS[1]);
    expect(header[4]).toBe(INSERTED_HEADERS[2]);
    expect(header[5]).toBe("เลขที่เอกสาร");
    expect(header[6]).toBe("ห้อง");
  });

  it("merges the heading cells the report merges, shifted right", () => {
    const merges = (sheet1 as unknown as { model: { merges: string[] } }).model.merges;
    expect(merges.slice(0, 2)).toEqual(["L4:Q4", "R4:Z4"]);
    expect(sheet1.getCell("L4").value).toBe("มูลค่าสินค้าที่ยกเว้นภาษี");
    // The repeated copies are gone - M4..Q4 now belong to the merge, and the
    // written file holds the text once (checked in the XML by hand).
    expect(sheet1.getCell("M4").isMerged).toBe(true);
    expect(sheet1.getCell("M4").master.address).toBe("L4");
    expect(sheet1.getCell("Q4").master.address).toBe("L4");
    expect(sheet1.getCell("R4").master.address).toBe("R4");
  });

  it("keeps one row per report line, in the report's order", () => {
    // data rows, the รวม row, a blank row, then 7 type rows and 3 total rows
    expect(sheet1.rowCount).toBe(report.sheet.headerRow + result.lines.length + 1 + 1 + 10);
    const first = sheet1.getRow(report.sheet.headerRow + 1).values as unknown[];
    expect(first[5]).toBe(result.lines[0]!.id);
  });

  it("writes time, status and note on a matched line", () => {
    const line = result.lines.find((l) => l.id === "RCD202605000002")!;
    const rowNumber = report.sheet.headerRow + result.lines.indexOf(line) + 1;
    const row = sheet1.getRow(rowNumber);
    expect(row.getCell("B").value).toBe("09:24");
    expect(row.getCell("C").value).toBe(STATUS.matched);
    expect(row.getCell("D").value).toBe(line.notes.join(" / "));
  });

  it("marks a line with no receipt as ขาดบิล", () => {
    const line = result.lines.find((l) => !l.hasReceipt)!;
    const rowNumber = report.sheet.headerRow + result.lines.indexOf(line) + 1;
    expect(sheet1.getRow(rowNumber).getCell("C").value).toBe(STATUS.missingBill);
  });

  it("puts a dropdown on every status cell", () => {
    const cell = sheet1.getRow(report.sheet.headerRow + 1).getCell("C");
    expect(cell.dataValidation?.type).toBe("list");
    expect(cell.dataValidation?.formulae?.[0]).toContain("ยอดตรง");
    expect(cell.dataValidation?.formulae?.[0]).toContain("ขาดบิล");
  });

  it("colors the status by rule, not by a static fill", () => {
    const formats = (sheet1 as unknown as { conditionalFormattings: { rules: { formulae?: string[] }[] }[] })
      .conditionalFormattings;
    const formulae = formats.flatMap((f) => f.rules.flatMap((r) => r.formulae ?? []));
    expect(formulae).toContain('"ยอดตรง"');
    expect(formulae).toContain('"ตรวจสอบข้อมูล"');
    expect(formulae).toContain('"ขาดบิล"');
    // The cell itself carries no fill - the rule paints it.
    expect(sheet1.getRow(report.sheet.headerRow + 1).getCell("C").fill).toBeUndefined();
  });

  describe("the รวม row under the data", () => {
    const lastDataRow = report.sheet.headerRow + result.lines.length;
    const totalsRow = lastDataRow + 1;

    it("labels itself in the เลขมิเตอร์ไฟฟ้าล่าสุด column", () => {
      // K is เลขมิเตอร์ไฟฟ้าล่าสุด after the three inserted columns.
      expect(sheet1.getRow(report.sheet.headerRow).getCell("K").value).toBe("เลขมิเตอร์ไฟฟ้าล่าสุด");
      expect(sheet1.getRow(totalsRow).getCell("K").value).toBe("รวม");
    });

    it("sums every money column, and no meter column", () => {
      const row = sheet1.getRow(totalsRow);
      expect((row.getCell("L").value as { formula: string }).formula).toBe(`SUM(L6:L${lastDataRow})`);
      expect((row.getCell("AC").value as { formula: string }).formula).toBe(`SUM(AC6:AC${lastDataRow})`);
      // The meter readings are counters, not money.
      for (const column of ["H", "I", "J", "K"]) {
        const value = row.getCell(column).value;
        expect(typeof value === "object" && value !== null && "formula" in value).toBe(false);
      }
    });
  });

  describe("the summary block", () => {
    const lastDataRow = report.sheet.headerRow + result.lines.length;
    const totalsRow = lastDataRow + 1;
    const top = totalsRow + 2; // one blank row in between
    const ids = `$E$${report.sheet.headerRow + 1}:$E$${lastDataRow}`;
    const net = `$AC$${report.sheet.headerRow + 1}:$AC$${lastDataRow}`;

    it("leaves exactly one blank row after the รวม row", () => {
      const blank = sheet1.getRow(totalsRow + 1);
      expect(blank.getCell("Z").value).toBeNull();
      expect(blank.getCell("AC").value).toBeNull();
    });

    it("sums each charge type with a SUMIF on the document-number prefix", () => {
      const expected = [
        ["ค่าปรับ/ค่าบริการ", "RA2026*"],
        ["เงินจอง", "RB2026*"],
        ["รายเดือน", "RC2026*"],
        ["ค่าประกัน", "RD2026*"],
        ["รายอาทิตย์", "RI2026*"],
        ["ย้ายออก", "RO2026*"],
        ["รายวัน", "RCD2026*"],
      ];
      expected.forEach(([label, pattern], index) => {
        const row = sheet1.getRow(top + index);
        // The figures line up under รวมสุทธิ (AC); the labels sit to its left.
        expect(row.getCell("AA").value).toBe(label);
        expect(row.getCell("AB").value).toBe(pattern);
        expect((row.getCell("AC").value as { formula: string }).formula).toBe(
          `SUMIF(${ids},"${pattern}",${net})`,
        );
        expect(row.getCell("AC").numFmt).toBe("#,##0.00");
      });
    });

    it("totals the seven rows, subtracts what is marked cancelled", () => {
      const totalRow = top + 7;
      expect(sheet1.getRow(totalRow).getCell("AB").value).toBe("ยอดรวม");
      expect((sheet1.getRow(totalRow).getCell("AC").value as { formula: string }).formula).toBe(
        `SUM(AC${top}:AC${top + 6})`,
      );

      expect(sheet1.getRow(totalRow + 1).getCell("AB").value).toBe(STATUS.cancelled);
      expect((sheet1.getRow(totalRow + 1).getCell("AC").value as { formula: string }).formula).toBe(
        `SUMIF($C$${report.sheet.headerRow + 1}:$C$${lastDataRow},"${STATUS.cancelled}",${net})`,
      );

      expect(sheet1.getRow(totalRow + 2).getCell("AB").value).toBe("ยอดสุทธิ");
      expect((sheet1.getRow(totalRow + 2).getCell("AC").value as { formula: string }).formula).toBe(
        `AC${totalRow}-AC${totalRow + 1}`,
      );
    });

    it("takes the year from the sheet, and totals every year present", async () => {
      // Same data, pretending the report straddles a year end.
      const straddling = await buildWorkbook({
        result: { ...result, years: ["2026", "2027"] },
        report: report.sheet,
        statement: statement.sheet,
        company: "44 Residence",
      });
      const reopened = new ExcelJS.Workbook();
      await reopened.xlsx.load(straddling as unknown as ArrayBuffer);
      const row = reopened.getWorksheet(SHEET_MATCHING)!.getRow(top);

      expect(row.getCell("AB").value).toBe("RA2026* + RA2027*");
      expect((row.getCell("AC").value as { formula: string }).formula).toBe(
        `SUMIF(${ids},"RA2026*",${net})+SUMIF(${ids},"RA2027*",${net})`,
      );
    });

    it("widens the columns it writes, so Excel never shows ###", () => {
      for (const column of ["Z", "AA", "AB", "AC"]) {
        expect(sheet1.getColumn(column).width ?? 0).toBeGreaterThanOrEqual(15);
      }
      // The รวม row's money columns too.
      expect(sheet1.getColumn("L").width ?? 0).toBeGreaterThanOrEqual(15);
    });

    it("heads the block with the report's own title line and the company", () => {
      const heading = String(sheet1.getCell(`Z${top}`).value);
      expect(heading).toContain("รายงานใบเสร็จรับเงิน");
      expect(heading).toContain("44 Residence");
    });

    it("offers all six statuses in the dropdown, each with its own color rule", () => {
      const cell = sheet1.getRow(report.sheet.headerRow + 1).getCell("C");
      const formats = (sheet1 as unknown as { conditionalFormattings: { rules: { formulae?: string[] }[] }[] })
        .conditionalFormattings;
      const formulae = formats.flatMap((f) => f.rules.flatMap((r) => r.formulae ?? []));

      for (const status of STATUS_OPTIONS) {
        expect(cell.dataValidation?.formulae?.[0]).toContain(status);
        expect(formulae).toContain(`"${status}"`);
      }
      expect(STATUS_OPTIONS).toHaveLength(6);
    });

    it("covers every document number - the seven rows equal the whole column", () => {
      // ยอดรวม is the sum of the seven rows, so a prefix outside the seven
      // would quietly vanish. Catch that here instead of in the workbook.
      const byPrefix = new Map<string, number>();
      let all = 0;
      for (const line of result.lines) {
        const prefix = /^([A-Z]+)2026/.exec(line.id)?.[1] ?? "??";
        byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + line.totalPaymentDue);
        all += line.totalPaymentDue;
      }
      const known = ["RA", "RB", "RC", "RD", "RI", "RO", "RCD"];
      expect([...byPrefix.keys()].filter((p) => !known.includes(p))).toEqual([]);
      expect([...byPrefix.values()].reduce((a, b) => a + b, 0)).toBe(all);
    });
  });

  it("inserts bill_id as the statement's second column", () => {
    const header = sheet2.getRow(statement.sheet.headerRow).values as unknown[];
    expect(header[1]).toBe("วันที่/เวลา");
    expect(header[2]).toBe("bill_id");
    expect(header[3]).toBe("ถอน");

    const matched = result.statement.find((r) => r.billId !== null)!;
    const row = sheet2.getRow(matched.sourceRow);
    expect(row.getCell(2).value).toBe(matched.billId);
    expect(row.getCell(4).value).toBe("749.00");
  });

  it("flags a bill_id whose line still needs a human", () => {
    const lastDataRow = report.sheet.headerRow + result.lines.length;
    const formats = (sheet2 as unknown as { conditionalFormattings: { ref: string; rules: { formulae?: string[] }[] }[] })
      .conditionalFormattings;
    const rule = formats.flatMap((f) => f.rules.map((r) => ({ ref: f.ref, formula: r.formulae?.[0] })))[0]!;

    expect(rule.ref).toBe(`B${statement.sheet.headerRow + 1}:B${statement.sheet.headerRow + statement.sheet.raw.size}`);
    // Looks the status up on sheet 1, so fixing it there clears the highlight.
    expect(rule.formula).toContain(`'${SHEET_MATCHING}'!$E$${report.sheet.headerRow + 1}:$E$${lastDataRow}`);
    expect(rule.formula).toContain(`'${SHEET_MATCHING}'!$C$${report.sheet.headerRow + 1}:$C$${lastDataRow}`);
    expect(rule.formula).toContain(STATUS.needsReview);
  });

  it("keeps every statement row, including withdrawals and the footer", () => {
    expect(sheet2.rowCount).toBe(statement.sheet.headerRow + statement.sheet.raw.size);
  });
});
