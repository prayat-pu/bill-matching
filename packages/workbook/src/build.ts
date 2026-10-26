import ExcelJS from "exceljs";
import { PREFIX_KINDS, STATUS, STATUS_OPTIONS, parseStatementDateTime } from "@bill/core";
import type { ReconcileResult, SheetSnapshot, Status } from "@bill/core";

export const SHEET_MATCHING = "Matching Report";
export const SHEET_STATEMENT = "add-statement";

/** The columns added to the accounting report, in order. */
export const INSERTED_HEADERS = ["match_bill_status", "note"] as const;

/**
 * The receipt's time goes into the report's own วันที่ column, which becomes a
 * real datetime cell rather than a date and a separate text column. ExcelJS
 * writes a Date against UTC, and the engine builds its dates with Date.UTC,
 * so the wall clock survives whatever timezone the machine is in.
 */
const DATETIME_FORMAT = "yyyy-mm-dd hh:mm:ss";

/** They go in front of เลขที่เอกสาร, which is column B in the export. */
const INSERT_AT = 2;

/** Colors for the status cell. Conditional, so the accountant can re-pick. */
const STATUS_FILL: Record<Status, string | null> = {
  [STATUS.matched]: "FFC6EFCE", // green
  [STATUS.needsReview]: "FFFFEB9C", // yellow
  [STATUS.missingBill]: "FFFFC7CE", // red
  [STATUS.overpaid]: "FFDCE9FF", // blue - paid too much
  [STATUS.underpaid]: "FFE6DAF5", // purple - paid too little
  [STATUS.cancelled]: "FFFFD9A0", // orange
  [STATUS.cash]: null,
  [STATUS.payAtProperty]: null,
};

const STATUS_FONT: Record<string, string> = {
  FFC6EFCE: "FF006100",
  FFFFEB9C: "FF9C5700",
  FFFFC7CE: "FF9C0006",
  FFDCE9FF: "FF1F4E79",
  FFE6DAF5: "FF5B2C8D",
  FFFFD9A0: "FF7F4F00",
};

/** The bill_id of a deposit whose line still needs a human. */
const UNCERTAIN_FILL = "FFFFEB9C";

/** The summary block under the data. */
const SUMMARY_GAP_ROWS = 1;
/** Everything after this header is money; everything up to it is meter counts. */
const LAST_NON_MONEY_HEADER = "เลขมิเตอร์ไฟฟ้าล่าสุด";
const TOTAL_FILL = "FFFFC000";
const CANCELLED_FILL = "FFFCE4EC";
const NET_FILL = "FFFFC000";
const THIN_BORDER = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
/** Excel shows ### when a number does not fit, so every column that gets a
 *  total has to be wide enough for it. */
const MONEY_COLUMN_WIDTH = 15;

type CellValue = string | number | Date | null;

/** Where sheet 1 put the columns sheet 2 has to point at. */
interface MatchingColumns {
  readonly idColumn: number;
  readonly statusColumn: number;
  readonly firstDataRow: number;
  readonly lastDataRow: number;
}

export interface BuildInput {
  readonly result: ReconcileResult;
  readonly report: SheetSnapshot;
  readonly statement: SheetSnapshot;
  /** Shown in the summary block's heading cell. */
  readonly company: string;
}

/**
 * The deliverable: one workbook, two sheets.
 *
 * Sheet 1 is the accounting report as uploaded, with `time`,
 * `match_bill_status` and `note` inserted as columns B, C and D. The status
 * cell is a dropdown and its color comes from conditional formatting, so
 * changing the dropdown recolors the cell without re-running the app.
 *
 * Sheet 2 is the bank statement as uploaded, with `bill_id` inserted as the
 * second column.
 */
export async function buildWorkbook(input: BuildInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const columns = buildMatchingSheet(workbook, input);
  buildStatementSheet(workbook, input, columns);
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

function buildMatchingSheet(
  workbook: ExcelJS.Workbook,
  { result, report, company }: BuildInput,
): MatchingColumns {
  const sheet = workbook.addWorksheet(SHEET_MATCHING, {
    views: [{ state: "frozen", ySplit: report.headerRow }],
  });

  const inserted = INSERTED_HEADERS.length;
  for (const row of report.preamble) sheet.addRow(insert(toValues(row), new Array(inserted).fill(null)));

  const headerRow = sheet.addRow(insert(toValues(report.header), [...INSERTED_HEADERS]));
  headerRow.font = { bold: true };

  const statusColumn = INSERT_AT;
  const noteColumn = INSERT_AT + 1;
  const dateColumn = reportColumn(report, "วันที่", 1);

  // One output row per report line, in the report's own order.
  for (const line of result.lines) {
    const original = toValues(report.raw.get(line.sourceRow) ?? []);
    // Pad so the report's own columns always land in the same place.
    while (original.length < report.header.length) original.push(null);
    const row = sheet.addRow(insert(original, [line.status, line.notes.join(" / ")]));

    // วันที่ carries the time of day now: the report's date with the receipt's
    // handwritten time, or midnight when there is no receipt.
    const date = row.getCell(dateColumn);
    date.value = line.datetime;
    date.numFmt = DATETIME_FORMAT;

    row.getCell(statusColumn).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${STATUS_OPTIONS.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "สถานะไม่ถูกต้อง",
      error: `เลือกได้เฉพาะ ${STATUS_OPTIONS.join(" / ")}`,
    };
    row.getCell(noteColumn).alignment = { wrapText: true, vertical: "top" };
  }

  // The report's heading block merges cells (I4:N4 and O4:W4 in the real
  // export); reproduce them, shifted by the columns we inserted.
  for (const range of shiftMerges(report.merges, INSERT_AT, inserted)) sheet.mergeCells(range);

  const firstDataRow = report.headerRow + 1;
  const lastDataRow = report.headerRow + result.lines.length;
  if (lastDataRow >= firstDataRow) {
    const column = columnLetter(statusColumn);
    sheet.addConditionalFormatting({
      ref: `${column}${firstDataRow}:${column}${lastDataRow}`,
      rules: STATUS_OPTIONS.map((status, index) => {
        const fill = STATUS_FILL[status];
        return {
          type: "cellIs" as const,
          operator: "equal" as const,
          formulae: [`"${status}"`],
          priority: index + 1,
          style: {
            fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: fill ?? "FFFFFFFF" } },
            font: { color: { argb: STATUS_FONT[fill ?? ""] ?? "FF000000" } },
          },
        };
      }),
    });
  }

  // "2026-05-01 09:24:00" needs the room, or Excel shows ###.
  widen(sheet, dateColumn, 20);
  sheet.getColumn(statusColumn).width = 18;
  sheet.getColumn(noteColumn).width = 42;

  const totalsRow = writeColumnTotals(sheet, { report, firstDataRow, lastDataRow });
  writeSummary(sheet, { result, report, company, firstDataRow, lastDataRow, statusColumn, totalsRow });

  return {
    idColumn: reportColumn(report, "เลขที่เอกสาร", 2),
    statusColumn,
    firstDataRow,
    lastDataRow,
  };
}

interface TotalsInput {
  readonly report: SheetSnapshot;
  readonly firstDataRow: number;
  readonly lastDataRow: number;
}

/**
 * A TOTAL row straight under the data: =SUM of every money column, from the
 * one after เลขมิเตอร์ไฟฟ้าล่าสุด to รวมสุทธิ. The meter readings before it are
 * counters, not money, so summing them would be nonsense.
 *
 * Returns the row it wrote on.
 */
function writeColumnTotals(sheet: ExcelJS.Worksheet, input: TotalsInput): number {
  const { report, firstDataRow, lastDataRow } = input;
  const lastMeterColumn = reportColumn(report, LAST_NON_MONEY_HEADER, 0);
  const netColumn = reportColumn(report, "รวมสุทธิ", report.header.length);
  const firstMoneyColumn = lastMeterColumn === 0 ? firstNumericColumn(report) : lastMeterColumn + 1;

  const rowNumber = lastDataRow + 1;
  const row = sheet.getRow(rowNumber);

  // "รวม" sits in the column just before the first summed one.
  if (firstMoneyColumn > 1) {
    const label = row.getCell(firstMoneyColumn - 1);
    label.value = "รวม";
    label.font = { bold: true };
    label.alignment = { horizontal: "right" };
  }

  for (let column = firstMoneyColumn; column <= netColumn; column += 1) {
    if (!columnHoldsNumbers(report, column)) continue;
    const letter = columnLetter(column);
    const cell = row.getCell(column);
    cell.value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
    cell.numFmt = "#,##0.00";
    cell.font = { bold: true };
    cell.border = { top: { style: "double", color: { argb: "FF808080" } } };
    widen(sheet, column, MONEY_COLUMN_WIDTH);
  }

  row.commit();
  return rowNumber;
}

/** Never narrow a column, only widen it. */
function widen(sheet: ExcelJS.Worksheet, column: number, width: number): void {
  const target = sheet.getColumn(column);
  if ((target.width ?? 0) < width) target.width = width;
}

/** Does this output column hold numbers in the report's own data? */
function columnHoldsNumbers(report: SheetSnapshot, column: number): boolean {
  const source = column - (column >= INSERT_AT + INSERTED_HEADERS.length ? INSERTED_HEADERS.length : 0);
  for (const row of report.raw.values()) {
    const cell = row[source - 1];
    if (typeof cell === "number") return true;
    if (typeof cell === "string" && cell.trim() !== "" && Number.isFinite(Number(cell.replace(/,/g, "")))) {
      return true;
    }
  }
  return false;
}

function firstNumericColumn(report: SheetSnapshot): number {
  for (let column = 1; column <= report.header.length + INSERTED_HEADERS.length; column += 1) {
    if (columnHoldsNumbers(report, column)) return column;
  }
  return 1;
}

interface SummaryInput {
  readonly result: ReconcileResult;
  readonly report: SheetSnapshot;
  readonly company: string;
  readonly firstDataRow: number;
  readonly lastDataRow: number;
  readonly statusColumn: number;
  readonly totalsRow: number;
}

/**
 * The block the accountant reads: one line per charge type, summed from the
 * document-number prefix, then grand total, cancelled and net.
 *
 * Every figure is a live SUMIF/SUM, so marking a row ยกเลิกบิล in the dropdown
 * moves the cancelled line and the net total inside Excel.
 */
function writeSummary(sheet: ExcelJS.Worksheet, input: SummaryInput): void {
  const { result, report, company, firstDataRow, lastDataRow, statusColumn, totalsRow } = input;
  const idColumn = reportColumn(report, "เลขที่เอกสาร", 2);
  const netColumn = reportColumn(report, "รวมสุทธิ", report.header.length);

  const ids = absoluteRange(idColumn, firstDataRow, lastDataRow);
  const net = absoluteRange(netColumn, firstDataRow, lastDataRow);
  const statuses = absoluteRange(statusColumn, firstDataRow, lastDataRow);

  const top = totalsRow + SUMMARY_GAP_ROWS + 1;
  // The block's figures line up under รวมสุทธิ; its three label columns sit
  // immediately to the left of it.
  const amountColumn = netColumn;
  const patternColumn = netColumn - 1;
  const labelColumn = netColumn - 2;
  const headingColumn = netColumn - 3;
  const amount = columnLetter(amountColumn);

  // The years come from the document numbers in the sheet, never from a
  // literal: next year's report sums itself. A report that straddles two
  // years gets one SUMIF per year, added together.
  const years = result.years.length > 0 ? result.years : [result.year];

  PREFIX_KINDS.forEach((kind, index) => {
    const row = sheet.getRow(top + index);
    const patterns = years.map((year) => `${kind.code}${year}*`);
    row.getCell(labelColumn).value = kind.label;
    row.getCell(patternColumn).value = patterns.join(" + ");
    row.getCell(amountColumn).value = {
      formula: patterns.map((pattern) => `SUMIF(${ids},"${pattern}",${net})`).join("+"),
    };
    styleSummaryRow(row, headingColumn, amountColumn);
  });

  const firstKind = top;
  const lastKind = top + PREFIX_KINDS.length - 1;
  const totalRow = lastKind + 1;
  const cancelledRow = totalRow + 1;
  const netRow = cancelledRow + 1;

  const columns = { heading: headingColumn, pattern: patternColumn, amount: amountColumn };
  writeTotal(sheet.getRow(totalRow), "ยอดรวม", `SUM(${amount}${firstKind}:${amount}${lastKind})`, TOTAL_FILL, true, columns);
  writeTotal(
    sheet.getRow(cancelledRow),
    STATUS.cancelled,
    `SUMIF(${statuses},"${STATUS.cancelled}",${net})`,
    CANCELLED_FILL,
    false,
    columns,
  );
  writeTotal(
    sheet.getRow(netRow),
    "ยอดสุทธิ",
    `${amount}${totalRow}-${amount}${cancelledRow}`,
    NET_FILL,
    true,
    columns,
  );

  // The heading: the report's own title line, then the company.
  const heading = sheet.getCell(top, headingColumn);
  heading.value = `${reportTitle(report)}\n${company}`;
  heading.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  heading.font = { bold: true };
  sheet.mergeCells(top, headingColumn, lastKind, headingColumn);

  // The block's own columns carry long Thai labels and seven-figure sums.
  widen(sheet, headingColumn, 30);
  widen(sheet, labelColumn, 22);
  widen(sheet, patternColumn, 20);
  widen(sheet, amountColumn, MONEY_COLUMN_WIDTH);

  for (const row of [totalRow, cancelledRow, netRow]) sheet.getRow(row).commit();
}

interface SummaryColumns {
  readonly heading: number;
  readonly pattern: number;
  readonly amount: number;
}

function writeTotal(
  row: ExcelJS.Row,
  label: string,
  formula: string,
  fill: string,
  bold: boolean,
  columns: SummaryColumns,
): void {
  row.getCell(columns.pattern).value = label;
  row.getCell(columns.amount).value = { formula };
  styleSummaryRow(row, columns.heading, columns.amount);
  for (const column of [columns.pattern, columns.amount]) {
    const cell = row.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.font = { bold };
  }
}

function styleSummaryRow(row: ExcelJS.Row, from: number, to: number): void {
  for (let column = from; column <= to; column += 1) {
    const cell = row.getCell(column);
    cell.border = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
  }
  const value = row.getCell(to);
  value.numFmt = "#,##0.00";
  value.alignment = { horizontal: "right" };
}

/** Find one of the report's own columns by its Thai header, after the insert. */
function reportColumn(report: SheetSnapshot, header: string, fallback: number): number {
  const index = report.header.findIndex((cell) => String(cell ?? "").trim() === header);
  const original = index === -1 ? fallback : index + 1;
  return original >= INSERT_AT ? original + INSERTED_HEADERS.length : original;
}

/** The report's own title line, e.g. "รายงานใบเสร็จรับเงิน วันที่ 01/05/2026 - 31/05/2026)". */
function reportTitle(report: SheetSnapshot): string {
  for (const row of report.preamble.slice(1)) {
    const text = String(row[0] ?? "").trim();
    if (text !== "") return text;
  }
  return String(report.preamble[0]?.[0] ?? "").trim();
}

/** $E$6:$E$1131 - absolute so sorting the sheet cannot drift the formulas. */
function absoluteRange(column: number, firstRow: number, lastRow: number): string {
  const letter = columnLetter(column);
  return `$${letter}$${firstRow}:$${letter}$${lastRow}`;
}

function buildStatementSheet(
  workbook: ExcelJS.Workbook,
  { result, statement }: BuildInput,
  matching: MatchingColumns,
): void {
  const sheet = workbook.addWorksheet(SHEET_STATEMENT, {
    views: [{ state: "frozen", ySplit: statement.headerRow }],
  });

  // Which bill each deposit paid, by its row in the uploaded statement.
  const billIdByRow = new Map<number, string>();
  for (const row of result.statement) {
    if (row.billId !== null) billIdByRow.set(row.sourceRow, row.billId);
  }

  for (const row of statement.preamble) sheet.addRow(insert(toValues(row), [null]));

  const headerRow = sheet.addRow(insert(toValues(statement.header), ["bill_id"]));
  headerRow.font = { bold: true };

  for (const [sourceRow, row] of [...statement.raw].sort((a, b) => a[0] - b[0])) {
    const written = sheet.addRow(insert(toValues(row), [billIdByRow.get(sourceRow) ?? null]));

    // วันที่/เวลา arrives as "01/05/2026\n07:58:27" - one cell, day-first, with
    // a newline in the middle. Make it a real datetime, like sheet 1. The
    // footer rows (ถอนเงินรวม / ฝากเงินรวม) hold a label, not a date, and are
    // left exactly as they came.
    const parsed = parseStatementDateTime(row[0]);
    if (parsed !== null) {
      const cell = written.getCell(1);
      cell.value = parsed;
      cell.numFmt = DATETIME_FORMAT;
    }
  }

  for (const range of shiftMerges(statement.merges, 2, 1)) sheet.mergeCells(range);

  // A deposit whose bill still needs a human turns yellow here too. It is an
  // expression rule, not a painted cell, so fixing the status on sheet 1
  // clears the highlight without re-running the app.
  const firstRow = statement.headerRow + 1;
  const lastRow = statement.headerRow + statement.raw.size;
  if (lastRow >= firstRow) {
    const ids = sheetOneRange(matching.idColumn, matching);
    const statuses = sheetOneRange(matching.statusColumn, matching);
    sheet.addConditionalFormatting({
      ref: `B${firstRow}:B${lastRow}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: [`AND($B${firstRow}<>"",COUNTIFS(${ids},$B${firstRow},${statuses},"${STATUS.needsReview}")>0)`],
          style: {
            fill: { type: "pattern", pattern: "solid", fgColor: { argb: UNCERTAIN_FILL } },
            font: { color: { argb: STATUS_FONT[UNCERTAIN_FILL] ?? "FF000000" } },
          },
        },
      ],
    });
  }

  // "2026-05-01 07:58:27" needs the room, or Excel shows ###.
  widen(sheet, 1, 20);
  widen(sheet, 2, 20);
  widen(sheet, 7, 46);
}

/** An absolute range on sheet 1, for a formula living on sheet 2. */
function sheetOneRange(column: number, matching: MatchingColumns): string {
  const letter = columnLetter(column);
  return `'${SHEET_MATCHING}'!$${letter}$${matching.firstDataRow}:$${letter}$${matching.lastDataRow}`;
}

/** Put `added` into `values` at the 1-based column `INSERT_AT`. */
function insert(values: CellValue[], added: readonly CellValue[]): CellValue[] {
  const before = values.slice(0, INSERT_AT - 1);
  while (before.length < INSERT_AT - 1) before.push(null);
  return [...before, ...added, ...values.slice(INSERT_AT - 1)];
}

/** Move a merged range right by `count` columns if it sits at or after `at`. */
export function shiftMerges(ranges: readonly string[], at: number, count: number): string[] {
  return ranges.map((range) =>
    range
      .split(":")
      .map((ref) => {
        const match = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
        if (match === null) return ref;
        const column = columnNumber(match[1]!);
        return `${columnLetter(column >= at ? column + count : column)}${match[2]}`;
      })
      .join(":"),
  );
}

function toValues(row: readonly unknown[]): CellValue[] {
  return row.map((cell) => {
    if (cell === null || cell === undefined) return null;
    if (cell instanceof Date) return cell;
    if (typeof cell === "number" || typeof cell === "string") return cell;
    return String(cell);
  });
}

/** 1 -> A, 27 -> AA. */
export function columnLetter(column: number): string {
  let rest = column;
  let letters = "";
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** A -> 1, AA -> 27. */
export function columnNumber(letters: string): number {
  let total = 0;
  for (const letter of letters) total = total * 26 + (letter.charCodeAt(0) - 64);
  return total;
}
