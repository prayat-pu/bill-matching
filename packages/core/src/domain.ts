/**
 * Thai strings here are user-facing and are what the accountant reads and types
 * in the workbook. Do not translate or "tidy" them.
 */

import { toBaht, type Satang } from "./money.ts";

export const COMPANIES = ["44 Residence", "44 House", "44 Room", "44 Home"] as const;
export type Company = (typeof COMPANIES)[number];

export const STATUS = {
  matched: "ยอดตรง",
  needsReview: "ตรวจสอบข้อมูล",
  missingBill: "ขาดบิล",
  /** A named payer sent more than the bill. */
  overpaid: "โอนเกิน",
  /** A named payer sent less than the bill. */
  underpaid: "โอนขาด",
  cancelled: "ยกเลิกบิล",
  cash: "เงินสด",
  payAtProperty: "zuzuจ่าย ณ ที่พัก",
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

/**
 * The values offered by the status dropdown in the workbook. ยกเลิกบิล is set
 * by the engine when the report says so, and can also be picked by hand; the
 * summary block's cancelled line and net total follow either way. Cash and
 * pay-at-property stay in STATUS for when 44 Room and 44 Home are onboarded.
 */
export const STATUS_OPTIONS: readonly Status[] = [
  STATUS.matched,
  STATUS.needsReview,
  STATUS.missingBill,
  STATUS.overpaid,
  STATUS.underpaid,
  STATUS.cancelled,
];

/** Notes written into the `note` column. They are read by the accountant. */
export const NOTE = {
  /** The receipt's own total disagrees with the report's รวมสุทธิ. */
  amountMismatch: "ยอดเงินในบิลกับยอดเงินสุทธิไม่สอดคล้องกัน",
  /** The deposit is for the right amount, but someone else's name is on it. */
  payerNameMismatch: "ยอดเงินตรงแต่ชื่อผู้โอนไม่ตรง",
  /** Two receipts carried this document number - the model misread one of them. */
  duplicateReceipt: "มีใบเสร็จมากกว่าหนึ่งใบใช้เลขที่นี้ ตรวจสอบการอ่านเลขที่เอกสาร",
  /** The engine set ยกเลิกบิล from the report, not a person. */
  cancelledByReport: "ยกเลิกตามสถานะในรายงานบัญชี",
} as const;

/**
 * "โอนเกิน 51.00 บาท (รับ 800.00 / ควรได้ 749.00)".
 *
 * Only written when the statement names the customer, because only then do we
 * know the money is theirs. Computed in satang; baht appear at the last step.
 */
export function transferDifferenceNote(deposit: Satang, due: Satang): string {
  const difference = deposit - due;
  const label = difference > 0 ? STATUS.overpaid : STATUS.underpaid;
  return `${label} ${baht(Math.abs(difference))} บาท (รับ ${baht(deposit)} / ควรได้ ${baht(due)})`;
}

/**
 * "พบเงินเข้า 800.00 บาท เวลา 09:25 ใกล้เคียงกัน แต่ยอดและชื่อไม่ตรง".
 *
 * The only link to this bill is the clock, so no payment difference is
 * claimed - the accountant is told what was found and decides.
 */
export function nearbyDepositNote(deposit: Satang, time: string): string {
  return `พบเงินเข้า ${baht(deposit)} บาท เวลา ${time} ใกล้เคียงกัน แต่ยอดและชื่อไม่ตรง`;
}

const BAHT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function baht(amount: Satang): string {
  return BAHT.format(toBaht(amount));
}

/** Payment channel columns, in workbook order. */
export const CHANNELS = [
  "ยกเลิกบิล",
  "กรุงไทย",
  "เงินสด",
  "บัตรเครดิต",
  "โอนขาด",
  "โอนเกิน",
  "คืนประกัน",
  "ZUZUจ่าย ณ ที่พัก",
  "เข้าระบบZUZU",
] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * First match wins, top to bottom, against the receipt's free-text payment_info.
 * `ยกเลิกบิล` is not in this chain - cancellation is decided from the report
 * status column and beats everything.
 */
const CHANNEL_PATTERNS: ReadonlyArray<readonly [Channel, readonly string[]]> = [
  ["กรุงไทย", ["กรุงไทย", "ktb"]],
  ["เงินสด", ["เงินสด", "cash"]],
  ["บัตรเครดิต", ["บัตรเครดิต", "เครดิต", "credit"]],
  ["โอนขาด", ["โอนขาด"]],
  ["โอนเกิน", ["โอนเกิน"]],
  ["คืนประกัน", ["คืนประกัน"]],
  ["ZUZUจ่าย ณ ที่พัก", ["จ่าย ณ ที่พัก", "จ่ายณที่พัก", "pay at property"]],
  ["เข้าระบบZUZU", ["zuzu"]],
];

/** Which channel column a line's amount lands in. Null when nothing matches. */
export function classifyChannel(paymentInfo: string | null, cancelled: boolean): Channel | null {
  if (cancelled) return "ยกเลิกบิล";
  if (paymentInfo === null) return null;
  const text = paymentInfo.toLowerCase();
  for (const [channel, needles] of CHANNEL_PATTERNS) {
    if (needles.some((n) => text.includes(n.toLowerCase()))) return channel;
  }
  return null;
}

/** Payment methods that never reach the bank statement (step 3 force-match). */
export function offStatementStatus(paymentInfo: string | null): Status | null {
  const channel = classifyChannel(paymentInfo, false);
  if (channel === "เงินสด") return STATUS.cash;
  if (channel === "ZUZUจ่าย ณ ที่พัก") return STATUS.payAtProperty;
  return null;
}

/** The report's own status column marks a cancelled bill. */
export function isCancelledReportStatus(reportStatus: string | null): boolean {
  return reportStatus !== null && reportStatus.includes("ยกเลิก");
}

/**
 * Document-number prefixes. The year is NOT hardcoded - it is supplied by the
 * caller (derived from the data) so the tool keeps working next year.
 */
export const PREFIX_KINDS = [
  { code: "RA", label: "ค่าปรับ/ค่าบริการ" },
  { code: "RB", label: "เงินจอง" },
  { code: "RC", label: "รายเดือน" },
  { code: "RD", label: "ค่าประกัน" },
  { code: "RI", label: "รายอาทิตย์" },
  { code: "RO", label: "ย้ายออก" },
  { code: "RCD", label: "รายวัน" },
] as const;
export type PrefixCode = (typeof PREFIX_KINDS)[number]["code"];

/**
 * Which prefix a document number belongs to.
 * RCD is checked before RC, otherwise every daily bill is counted as monthly.
 */
export function prefixOf(id: string, year: string): PrefixCode | null {
  const upper = id.trim().toUpperCase();
  const ordered: PrefixCode[] = ["RCD", "RA", "RB", "RC", "RD", "RI", "RO"];
  for (const code of ordered) {
    if (upper.startsWith(`${code}${year}`)) return code;
  }
  return null;
}

/**
 * Every 4-digit year appearing in the document numbers, oldest first.
 * A report that straddles December and January carries two, and the summary
 * has to total both or the money in the other year vanishes.
 */
export function deriveYears(ids: readonly string[]): string[] {
  const years = new Set<string>();
  for (const id of ids) {
    const match = /^[A-Za-z]+(\d{4})/.exec(id.trim());
    if (match?.[1] !== undefined) years.add(match[1]);
  }
  return [...years].sort();
}

/** Most common 4-digit year appearing in the document numbers. */
export function deriveYear(ids: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const m = /^[A-Za-z]+(\d{4})/.exec(id.trim());
    if (m?.[1] === undefined) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [year, count] of counts) {
    if (count > bestCount) {
      best = year;
      bestCount = count;
    }
  }
  return best;
}
