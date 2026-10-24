/** Money is integer satang. Never float. */
export type Satang = number;

const NON_NUMERIC = /[^0-9.\-]/g;

/**
 * Parse an amount coming from Excel or from the LLM.
 * Accepts numbers, and strings with thousands commas / currency junk.
 * Returns null when there is nothing parseable.
 */
export function parseSatang(raw: unknown): Satang | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(NON_NUMERIC, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function toBaht(s: Satang): number {
  return s / 100;
}

/** Amount comparison with an explicit tolerance (default: exact to the satang). */
export function amountsAgree(a: Satang, b: Satang, toleranceSatang = 0): boolean {
  return Math.abs(a - b) <= toleranceSatang;
}
