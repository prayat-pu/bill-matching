import ExcelJS from "exceljs";
import type { SheetSnapshot } from "../types.ts";
import { LoadError } from "../errors.ts";

export type Cell = unknown;
export type Row = readonly Cell[];

export interface RawSheet {
  readonly rows: Row[];
  /** Merged ranges as the file declares them, e.g. "I4:N4". */
  readonly merges: string[];
}

/**
 * Read the first worksheet of an `.xlsx` into plain rows, 0-indexed.
 * Cell values are left as ExcelJS gives them; the loaders coerce.
 */
export async function readSheet(data: ArrayBuffer | Buffer, source: string): Promise<RawSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as ArrayBuffer);
  } catch (cause) {
    throw new LoadError(`${source}: not a readable .xlsx file (${String(cause)})`, { source });
  }
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new LoadError(`${source}: the workbook has no sheets`, { source });

  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = normalize(cell.value);
    });
    rows[rowNumber - 1] = values;
  });
  for (let i = 0; i < rows.length; i += 1) if (rows[i] === undefined) rows[i] = [];
  return { rows, merges: sheet.model.merges ?? [] };
}

function normalize(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return value.result ?? null;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    return String(value);
  }
  return value;
}

/** Map header labels to column indexes for the given header row. */
export function headerIndex(rows: readonly Row[], headerRowIndex: number, source: string): Map<string, number> {
  const header = rows[headerRowIndex];
  if (header === undefined) {
    throw new LoadError(
      `${source}: expected a header on row ${headerRowIndex + 1}, but the file has ${rows.length} rows`,
      { source },
    );
  }
  const map = new Map<string, number>();
  header.forEach((cell, index) => {
    const label = text(cell);
    if (label !== null && !map.has(label)) map.set(label, index);
  });
  return map;
}

export function requireColumn(
  index: ReadonlyMap<string, number>,
  label: string,
  source: string,
): number {
  const found = index.get(label);
  if (found === undefined) {
    throw new LoadError(
      `${source}: required column "${label}" is missing. Found: ${[...index.keys()].join(", ")}`,
      { source },
    );
  }
  return found;
}

/** Keep the sheet as uploaded so the output workbook can reproduce it. */
export function snapshot(
  rows: readonly Row[],
  headerRowIndex: number,
  merges: readonly string[] = [],
): SheetSnapshot {
  const raw = new Map<number, Row>();
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row !== undefined) raw.set(i + 1, row);
  }
  return {
    preamble: rows.slice(0, headerRowIndex),
    header: rows[headerRowIndex] ?? [],
    raw,
    headerRow: headerRowIndex + 1,
    // Only merges in the heading block survive: rows below the header are
    // rewritten one per report line, so their row numbers move.
    merges: merges.filter((range) => lastRowOf(range) <= headerRowIndex + 1),
  };
}

function lastRowOf(range: string): number {
  const rows = range.split(":").map((ref) => Number(/\d+/.exec(ref)?.[0] ?? "0"));
  return Math.max(...rows);
}

export function text(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) return cell.toISOString();
  const s = String(cell).trim();
  return s === "" ? null : s;
}
