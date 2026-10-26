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

  it("inserts the two columns at B and C, before เลขที่เอกสาร", () => {
    const header = sheet1.getRow(report.sheet.headerRow).values as unknown[];
    // ExcelJS pads index 0.
    expect(header[1]).toBe("วันที่");
    expect(header[2]).toBe(INSERTED_HEADERS[0]);
    expect(header[3]).toBe(INSERTED_HEADERS[1]);
    expect(header[4]).toBe("เลขที่เอกสาร");
    expect(header[5]).toBe("ห้อง");
  });

  it("writes วันที่ as a real datetime, carrying the receipt's time", () => {
    const line = result.lines.find((l) => l.id === "RCD202605000002")!;
    const rowNumber = report.sheet.headerRow + result.lines.indexOf(line) + 1;
    const cell = sheet1.getRow(rowNumber).getCell("A");

    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString()).toBe("2026-05-01T09:24:00.000Z");
    expect(cell.numFmt).toBe("yyyy-mm-dd hh:mm:ss");
    // Wide enough for "2026-05-01 09:24:00", or Excel shows ###.
    expect(sheet1.getColumn("A").width ?? 0).toBeGreaterThanOrEqual(20);
  });

  it("leaves a line with no receipt at midnight", () => {
    const line = result.lines.find((l) => !l.hasReceipt)!;
    const rowNumber = report.sheet.headerRow + result.lines.indexOf(line) + 1;
    const value = sheet1.getRow(rowNumber).getCell("A").value as Date;
    expect(value.getUTCHours()).toBe(0);
    expect(value.getUTCMinutes()).toBe(0);
  });

  it("merges the heading cells the report merges, shifted right", () => {
    const merges = (sheet1 as unknown as { model: { merges: string[] } }).model.merges;
    expect(merges.slice(0, 2)).toEqual(["K4:P4", "Q4:Y4"]);
    expect(sheet1.getCell("K4").value).toBe("มูลค่าสินค้าที่ยกเว้นภาษี");
    // The repeated copies are gone - L4..P4 now belong to the merge, and the
    // written file holds the text once (checked in the XML by hand).
    expect(sheet1.getCell("L4").isMerged).toBe(true);
    expect(sheet1.getCell("L4").master.address).toBe("K4");
    expect(sheet1.getCell("P4").master.address).toBe("K4");
    expect(sheet1.getCell("Q4").master.address).toBe("Q4");
  });

  it("keeps one row per report line, in the report's order", () => {
    // data rows, the รวม row, a blank row, then 7 type rows and 3 total rows
    expect(sheet1.rowCount).toBe(report.sheet.headerRow + result.lines.length + 1 + 1 + 10);
    const first = sheet1.getRow(report.sheet.headerRow + 1).values as unknown[];
    expect(first[4]).toBe(result.lines[0]!.id);
  });

  it("writes time, status and note on a matched line", () => {
    const line = result.lines.find((l) => l.id === "RCD202605000002")!;
    const rowNumber = report.sheet.headerRow + result.lines.indexOf(line) + 1;
    const row = sheet1.getRow(rowNumber);
    expect(row.getCell("B").value).toBe(STATUS.matched);
    expect(row.getCell("C").value).toBe(line.notes.join(" / "));
  });

  it("marks a line with no receipt as ขาดบิล", () => {
    const line = result.lines.find((l) => !l.hasReceipt)!;
    const rowNumber = report.sheet.headerRow + result.lines.indexOf(line) + 1;
    expect(sheet1.getRow(rowNumber).getCell("B").value).toBe(STATUS.missingBill);
  });

  it("puts a dropdown on every status cell", () => {
    const cell = sheet1.getRow(report.sheet.headerRow + 1).getCell("B");
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
    expect(sheet1.getRow(report.sheet.headerRow + 1).getCell("B").fill).toBeUndefined();
  });

  describe("the รวม row under the data", () => {
    const lastDataRow = report.sheet.headerRow + result.lines.length;
    const totalsRow = lastDataRow + 1;

    it("labels itself in the เลขมิเตอร์ไฟฟ้าล่าสุด column", () => {
      // K is เลขมิเตอร์ไฟฟ้าล่าสุด after the three inserted columns.
      expect(sheet1.getRow(report.sheet.headerRow).getCell("J").value).toBe("เลขมิเตอร์ไฟฟ้าล่าสุด");
      expect(sheet1.getRow(totalsRow).getCell("J").value).toBe("รวม");
    });

    it("sums every money column, and no meter column", () => {
      const row = sheet1.getRow(totalsRow);
      expect((row.getCell("K").value as { formula: string }).formula).toBe(`SUM(K6:K${lastDataRow})`);
      expect((row.getCell("AB").value as { formula: string }).formula).toBe(`SUM(AB6:AB${lastDataRow})`);
      // The meter readings are counters, not money.
      for (const column of ["G", "H", "I", "J"]) {
        const value = row.getCell(column).value;
        expect(typeof value === "object" && value !== null && "formula" in value).toBe(false);
      }
    });
  });

  describe("the summary block", () => {
    const lastDataRow = report.sheet.headerRow + result.lines.length;
    const totalsRow = lastDataRow + 1;
    const top = totalsRow + 2; // one blank row in between
    const ids = `$D$${report.sheet.headerRow + 1}:$D$${lastDataRow}`;
    const net = `$AB$${report.sheet.headerRow + 1}:$AB$${lastDataRow}`;

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
        expect(row.getCell("Z").value).toBe(label);
        expect(row.getCell("AA").value).toBe(pattern);
        expect((row.getCell("AB").value as { formula: string }).formula).toBe(
          `SUMIF(${ids},"${pattern}",${net})`,
        );
        expect(row.getCell("AB").numFmt).toBe("#,##0.00");
      });
    });

    it("totals the seven rows, subtracts what is marked cancelled", () => {
      const totalRow = top + 7;
      expect(sheet1.getRow(totalRow).getCell("AA").value).toBe("ยอดรวม");
      expect((sheet1.getRow(totalRow).getCell("AB").value as { formula: string }).formula).toBe(
        `SUM(AB${top}:AB${top + 6})`,
      );

      expect(sheet1.getRow(totalRow + 1).getCell("AA").value).toBe(STATUS.cancelled);
      expect((sheet1.getRow(totalRow + 1).getCell("AB").value as { formula: string }).formula).toBe(
        `SUMIF($B$${report.sheet.headerRow + 1}:$B$${lastDataRow},"${STATUS.cancelled}",${net})`,
      );

      expect(sheet1.getRow(totalRow + 2).getCell("AA").value).toBe("ยอดสุทธิ");
      expect((sheet1.getRow(totalRow + 2).getCell("AB").value as { formula: string }).formula).toBe(
        `AB${totalRow}-AB${totalRow + 1}`,
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

      expect(row.getCell("AA").value).toBe("RA2026* + RA2027*");
      expect((row.getCell("AB").value as { formula: string }).formula).toBe(
        `SUMIF(${ids},"RA2026*",${net})+SUMIF(${ids},"RA2027*",${net})`,
      );
    });

    it("widens the columns it writes, so Excel never shows ###", () => {
      for (const column of ["Y", "Z", "AA", "AB"]) {
        expect(sheet1.getColumn(column).width ?? 0).toBeGreaterThanOrEqual(15);
      }
      // The รวม row's money columns too.
      expect(sheet1.getColumn("K").width ?? 0).toBeGreaterThanOrEqual(15);
    });

    it("heads the block with the report's own title line and the company", () => {
      const heading = String(sheet1.getCell(`Y${top}`).value);
      expect(heading).toContain("รายงานใบเสร็จรับเงิน");
      expect(heading).toContain("44 Residence");
    });

    it("offers all six statuses in the dropdown, each with its own color rule", () => {
      const cell = sheet1.getRow(report.sheet.headerRow + 1).getCell("B");
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
    expect(rule.formula).toContain(`'${SHEET_MATCHING}'!$D$${report.sheet.headerRow + 1}:$D$${lastDataRow}`);
    expect(rule.formula).toContain(`'${SHEET_MATCHING}'!$B$${report.sheet.headerRow + 1}:$B$${lastDataRow}`);
    expect(rule.formula).toContain(STATUS.needsReview);
  });

  it("writes the statement's วันที่/เวลา as a datetime too", () => {
    // The first deposit in the real file is 01/05/2026 07:58:27.
    const first = result.statement[0]!;
    const cell = sheet2.getRow(first.sourceRow).getCell("A");
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString()).toBe("2026-05-01T07:58:27.000Z");
    expect(cell.numFmt).toBe("yyyy-mm-dd hh:mm:ss");
    expect(sheet2.getColumn("A").width ?? 0).toBeGreaterThanOrEqual(20);
  });

  it("leaves the footer rows alone - they hold a label, not a date", () => {
    const lastRow = statement.sheet.headerRow + statement.sheet.raw.size;
    const label = sheet2.getRow(lastRow).getCell("A").value;
    expect(typeof label).toBe("string");
    expect(String(label)).toContain("เงินรวม");
  });

  it("keeps every statement row, including withdrawals and the footer", () => {
    expect(sheet2.rowCount).toBe(statement.sheet.headerRow + statement.sheet.raw.size);
  });
});
