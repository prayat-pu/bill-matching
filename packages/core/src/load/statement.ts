import { parseStatementDateTime } from "../dates.ts";
import { parseSatang } from "../money.ts";
import type { Loaded, RejectedRow } from "../errors.ts";
import type { SheetSnapshot, StatementRow } from "../types.ts";
import { snapshot } from "./sheet.ts";
import { headerIndex, requireColumn, readSheet, text, type Row } from "./sheet.ts";

/** The real header is the 8th row of the bank statement. */
export const STATEMENT_HEADER_ROW_INDEX = 7;

const COLUMNS = {
  datetime: "วันที่/เวลา",
  deposit: "ฝาก",
  detail: "คำอธิบายรายละเอียด",
} as const;

export interface LoadedStatement extends Loaded<StatementRow> {
  readonly sheet: SheetSnapshot;
}

export async function loadStatementFile(
  data: ArrayBuffer | Buffer,
  source = "bank statement",
): Promise<LoadedStatement> {
  const sheet = await readSheet(data, source);
  return parseStatementRows(sheet.rows, source, sheet.merges);
}

export function parseStatementRows(
  rows: readonly Row[],
  source = "bank statement",
  merges: readonly string[] = [],
): LoadedStatement {
  const index = headerIndex(rows, STATEMENT_HEADER_ROW_INDEX, source);
  const datetimeCol = requireColumn(index, COLUMNS.datetime, source);
  const depositCol = requireColumn(index, COLUMNS.deposit, source);
  const detailCol = index.get(COLUMNS.detail);

  const out: StatementRow[] = [];
  const rejected: RejectedRow[] = [];

  for (let i = STATEMENT_HEADER_ROW_INDEX + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) continue;
    const sourceRow = i + 1;

    // The sheet ends with "ถอนเงินรวม" / "ฝากเงินรวม" totals - stop there, or
    // the deposit total would be read as a 1,025,370.00 deposit.
    if (isFooterLabel(row[datetimeCol])) break;

    // Withdrawals and blank lines have no deposit amount - not our business.
    const amount = parseSatang(row[depositCol]);
    if (amount === null) continue;

    const datetime = parseStatementDateTime(row[datetimeCol]);
    if (datetime === null) {
      rejected.push({ source, row: sourceRow, reason: "unreadable date/time on a deposit" });
    }

    out.push({
      index: out.length,
      datetime,
      amount,
      detail: (detailCol === undefined ? null : text(row[detailCol])) ?? "",
      sourceRow,
    });
  }

  return { rows: out, rejected, sheet: snapshot(rows, STATEMENT_HEADER_ROW_INDEX, merges) };
}

function isFooterLabel(cell: unknown): boolean {
  const label = text(cell);
  return label !== null && label.endsWith("เงินรวม");
}
