import { z } from "zod";
import { parseDayFirstDateTime } from "../dates.ts";
import { parseSatang } from "../money.ts";
import type { Loaded, RejectedRow } from "../errors.ts";
import type { Receipt } from "../types.ts";

/**
 * The shape the vision model must return, one object per receipt.
 * Validated here so a bad record is quarantined loudly instead of silently
 * turning into a missing bill.
 */
export const receiptRecordSchema = z.object({
  id: z.string().trim().min(1),
  date: z.string().trim().min(1),
  time: z.string().trim().optional().default(""),
  room: z.string().trim().optional().default(""),
  total_payment_due: z.union([z.string(), z.number()]).optional(),
  payment_info: z.string().optional(),
  company: z.string().optional(),
});

export type ReceiptRecord = z.infer<typeof receiptRecordSchema>;

/** Validate and normalize raw records from one extraction. */
export function parseReceiptRecords(
  records: readonly unknown[],
  source = "receipt extraction",
): Loaded<Receipt> {
  const out: Receipt[] = [];
  const rejected: RejectedRow[] = [];

  records.forEach((raw, i) => {
    const parsed = receiptRecordSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ source, row: i + 1, reason: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      return;
    }
    const record = parsed.data;
    const datetime = parseDayFirstDateTime(record.date, record.time);
    if (datetime === null) {
      rejected.push({ source, row: i + 1, reason: `bill ${record.id}: unreadable date "${record.date} ${record.time}"` });
      return;
    }
    out.push({
      id: record.id,
      datetime,
      room: emptyToNull(record.room),
      totalPaymentDue: parseSatang(record.total_payment_due),
      paymentInfo: emptyToNull(record.payment_info),
      company: emptyToNull(record.company),
    });
  });

  return { rows: out, rejected };
}

/** Per-company history dedupe: same bill id, last extraction wins. */
export function mergeReceipts(
  existing: readonly Receipt[],
  incoming: readonly Receipt[],
): Receipt[] {
  const byId = new Map<string, Receipt>();
  for (const receipt of [...existing, ...incoming]) byId.set(receipt.id.trim().toUpperCase(), receipt);
  return [...byId.values()];
}

function emptyToNull(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}
