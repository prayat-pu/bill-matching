import type { Satang } from "./money.ts";
import type { Channel, Company, Status } from "./domain.ts";
import type { Row } from "./load/sheet.ts";

/** One line of the accounting report (`.xlsx`, header on row 5). */
export interface ReportLine {
  readonly id: string;
  readonly date: Date;
  readonly room: string | null;
  readonly totalPaymentDue: Satang;
  readonly customerName: string | null;
  readonly reportStatus: string | null;
  /** 1-based row in the uploaded sheet, so the workbook can re-emit it. */
  readonly sourceRow: number;
}

/**
 * An uploaded sheet, verbatim, so the output workbook can look exactly like
 * the file the accountant exported.
 */
export interface SheetSnapshot {
  /** Rows above the header, verbatim. */
  readonly preamble: readonly Row[];
  readonly header: Row;
  /** Every row below the header, verbatim, keyed by 1-based sheet row. */
  readonly raw: ReadonlyMap<number, Row>;
  /** 1-based sheet row the header sits on. */
  readonly headerRow: number;
  /** Merged ranges in the heading block, e.g. "I4:N4". */
  readonly merges: readonly string[];
}

/** One deposit line of the bank statement (`.xlsx`, header on row 8). */
export interface StatementRow {
  readonly index: number;
  readonly datetime: Date | null;
  readonly amount: Satang;
  readonly detail: string;
  readonly sourceRow: number;
}

/** One receipt, as read off the paper by the vision model. */
export interface Receipt {
  readonly id: string;
  readonly datetime: Date;
  readonly room: string | null;
  readonly totalPaymentDue: Satang | null;
  readonly paymentInfo: string | null;
  readonly company: string | null;
}

/** One row of sheet 1, after reconciliation. In the report's own order. */
export interface MatchedLine {
  readonly id: string;
  /** The report's date, with the receipt's handwritten time where there is one. */
  readonly datetime: Date;
  /** `HH:mm` for the new time column, or "" when there is no receipt. */
  readonly time: string;
  readonly room: string | null;
  readonly customerName: string | null;
  /** From the report - the report always wins over the receipt's amount. */
  readonly totalPaymentDue: Satang;
  readonly receiptAmount: Satang | null;
  readonly paymentInfo: string | null;
  readonly hasReceipt: boolean;
  readonly status: Status;
  /** Notes for the `note` column, joined with " / " when written out. */
  readonly notes: readonly string[];
  readonly channel: Channel | null;
  readonly statementAmount: Satang | null;
  readonly statementIndex: number | null;
  readonly matchReason: MatchReason | null;
  readonly sourceRow: number;
}

export type MatchReason = "name" | "amount" | "time";

export interface ReconcileInput {
  readonly company: Company;
  readonly report: readonly ReportLine[];
  readonly statement: readonly StatementRow[];
  readonly receipts: readonly Receipt[];
}

export interface ReconcileOptions {
  /** Half-width of the deposit search window, in seconds. Biggest single
   *  driver of the match rate - set it deliberately. */
  readonly timeToleranceSeconds?: number;
  /** Allowed difference between report amount and deposit amount, in satang. */
  readonly amountToleranceSatang?: number;
}

export interface ReconcileResult {
  /** The year most of the document numbers carry. */
  readonly year: string;
  /** Every year present, oldest first - the summary totals all of them. */
  readonly years: readonly string[];
  readonly lines: readonly MatchedLine[];
  /** The statement, annotated with the bill each deposit paid (sheet 2). */
  readonly statement: readonly AnnotatedStatementRow[];
  readonly counts: ReconcileCounts;
  /** Receipts whose id is in no report line. Shown to the user, never dropped. */
  readonly receiptsNotInReport: readonly string[];
  /** Document numbers that arrived on more than one receipt. The model misread
   *  one of them, so neither can be trusted. */
  readonly duplicateReceiptIds: readonly string[];
}

export interface AnnotatedStatementRow extends StatementRow {
  readonly billId: string | null;
}

/** All counts share one denominator: report lines. */
export interface ReconcileCounts {
  readonly reportLines: number;
  readonly withReceipt: number;
  readonly matched: number;
  readonly needsReview: number;
  readonly missingBill: number;
  readonly withNotes: number;
}
