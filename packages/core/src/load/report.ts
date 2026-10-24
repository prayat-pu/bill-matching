import { parseDayFirstDate } from "../dates.ts";
import { parseSatang } from "../money.ts";
import type { Loaded, RejectedRow } from "../errors.ts";
import type { ReportLine, SheetSnapshot } from "../types.ts";
import { snapshot } from "./sheet.ts";
import { headerIndex, requireColumn, readSheet, text, type Row } from "./sheet.ts";

/** The real header is the 5th row of the accounting report. */
export const REPORT_HEADER_ROW_INDEX = 4;

const COLUMNS = {
  date: "วันที่",
  id: "เลขที่เอกสาร",
  room: "ห้อง",
  total: "รวมสุทธิ",
  customer: "ชื่อลูกค้า",
  status: "สถานะ",
} as const;

export interface LoadedReport extends Loaded<ReportLine> {
  readonly sheet: SheetSnapshot;
}

export async function loadReportFile(
  data: ArrayBuffer | Buffer,
  source = "accounting report",
): Promise<LoadedReport> {
  const sheet = await readSheet(data, source);
  return parseReportRows(sheet.rows, source, sheet.merges);
}

export function parseReportRows(
  rows: readonly Row[],
  source = "accounting report",
  merges: readonly string[] = [],
): LoadedReport {
  const index = headerIndex(rows, REPORT_HEADER_ROW_INDEX, source);
  const dateCol = requireColumn(index, COLUMNS.date, source);
  const idCol = requireColumn(index, COLUMNS.id, source);
  const totalCol = requireColumn(index, COLUMNS.total, source);
  const roomCol = index.get(COLUMNS.room);
  const customerCol = index.get(COLUMNS.customer);
  const statusCol = index.get(COLUMNS.status);

  const out: ReportLine[] = [];
  const rejected: RejectedRow[] = [];

  for (let i = REPORT_HEADER_ROW_INDEX + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) continue;
    const sourceRow = i + 1;

    const id = text(row[idCol]);
    // Rows with no document number are footers and blanks - drop them silently.
    if (id === null) continue;

    const date = parseDayFirstDate(row[dateCol]) ?? asDate(row[dateCol]);
    if (date === null) {
      rejected.push({ source, row: sourceRow, reason: `unreadable date for bill ${id}` });
      continue;
    }
    const totalPaymentDue = parseSatang(row[totalCol]);
    if (totalPaymentDue === null) {
      rejected.push({ source, row: sourceRow, reason: `unreadable amount for bill ${id}` });
      continue;
    }

    out.push({
      id,
      date,
      room: roomCol === undefined ? null : text(row[roomCol]),
      totalPaymentDue,
      customerName: customerCol === undefined ? null : text(row[customerCol]),
      reportStatus: statusCol === undefined ? null : text(row[statusCol]),
      sourceRow,
    });
  }

  return { rows: out, rejected, sheet: snapshot(rows, REPORT_HEADER_ROW_INDEX, merges) };
}

/** Excel sometimes hands back a real Date instead of a day-first string. */
function asDate(cell: unknown): Date | null {
  if (!(cell instanceof Date)) return null;
  return new Date(Date.UTC(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate()));
}
