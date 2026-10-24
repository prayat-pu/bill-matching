/**
 * Every date in this system is day-first (DD/MM/YYYY) wall-clock time.
 * We store it as an epoch built with Date.UTC so no local timezone can shift it.
 */

const DATE_RE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** A Buddhist-era year (e.g. 2569) is converted to CE. */
function normalizeYear(year: number): number {
  return year > 2400 ? year - 543 : year;
}

/** Midnight of a day-first date string. Null when unparseable. */
export function parseDayFirstDate(raw: unknown): Date | null {
  const text = cellText(raw);
  if (text === null) return null;
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = normalizeYear(Number(m[3]));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** Day-first date plus an optional HH:mm[:ss]. */
export function parseDayFirstDateTime(rawDate: unknown, rawTime?: unknown): Date | null {
  const day = parseDayFirstDate(rawDate);
  if (day === null) return null;
  const timeText = cellText(rawTime);
  if (timeText === null) return day;
  const m = TIME_RE.exec(timeText);
  if (!m) return day;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] === undefined ? 0 : Number(m[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return day;
  return new Date(day.getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000);
}

/**
 * Statement cells hold date and time in one cell separated by a literal newline
 * (sometimes just whitespace). Split and parse.
 */
export function parseStatementDateTime(raw: unknown): Date | null {
  if (raw instanceof Date) return raw;
  const text = cellText(raw);
  if (text === null) return null;
  const parts = text.split(/\s+/).filter((p) => p !== "");
  if (parts.length === 0) return null;
  return parseDayFirstDateTime(parts[0], parts[1]);
}

/** Date-only key used to join receipts to report lines. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function cellText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}
