import { amountsAgree } from "../money.ts";
import { NOTE, STATUS, classifyChannel, deriveYear, deriveYears } from "../domain.ts";
import { detailNamesCustomer, hasPayer } from "../names.ts";
import type {
  AnnotatedStatementRow,
  MatchReason,
  MatchedLine,
  ReconcileCounts,
  ReconcileInput,
  ReconcileOptions,
  ReconcileResult,
  Receipt,
  ReportLine,
  StatementRow,
} from "../types.ts";

/** The handwritten time on the slip is rounded by staff, so the window is wide
 *  enough to forgive a minute either way. */
const DEFAULT_TIME_TOLERANCE_SECONDS = 120;
const DEFAULT_AMOUNT_TOLERANCE_SATANG = 0;

interface Candidate {
  readonly lineIndex: number;
  readonly statementIndex: number;
  readonly nameMatch: boolean;
  /** Whether the detail names anyone at all - person or company. A QR
   *  PromptPay transfer names nobody. */
  readonly payerNamed: boolean;
  readonly amountMatch: boolean;
  readonly deltaMs: number;
}

export function reconcile(input: ReconcileInput, options: ReconcileOptions = {}): ReconcileResult {
  const toleranceMs = (options.timeToleranceSeconds ?? DEFAULT_TIME_TOLERANCE_SECONDS) * 1000;
  const amountTolerance = options.amountToleranceSatang ?? DEFAULT_AMOUNT_TOLERANCE_SATANG;

  const ids = input.report.map((r) => r.id);
  const year = deriveYear(ids) ?? String(new Date().getUTCFullYear());
  const years = deriveYears(ids);
  if (years.length === 0) years.push(year);

  // Step 1 - join receipts onto the report by document number alone. Every
  // report line survives; a line with no receipt is a missing bill.
  const receiptsById = indexReceipts(input.receipts);
  const duplicates = duplicateIds(input.receipts);
  const usedReceiptIds = new Set<string>();

  const draft: DraftLine[] = input.report.map((line) => {
    const key = idKey(line.id);
    const receipt = receiptsById.get(key) ?? null;
    if (receipt !== null) usedReceiptIds.add(key);
    return makeDraft(line, receipt, amountTolerance, duplicates.has(key));
  });

  // Step 2 - give each line with a receipt one bank deposit.
  const billIdByStatement = new Map<number, string>();
  const openLines = draft.flatMap((line, index) => (line.hasReceipt ? [index] : []));

  const available = new Set(
    input.statement.filter((row) => row.datetime !== null).map((row) => row.index),
  );
  const statementByIndex = new Map(input.statement.map((row) => [row.index, row]));

  // One deposit pays at most one bill. Score every pair inside the window,
  // then assign best-first, which keeps the name > amount > time policy while
  // making the assignment one-to-one.
  const candidates = buildCandidates(draft, openLines, input.statement, toleranceMs, amountTolerance);
  candidates.sort(compareCandidates);

  for (const candidate of candidates) {
    const line = draft[candidate.lineIndex];
    if (line === undefined || line.statementIndex !== null) continue;
    if (!available.has(candidate.statementIndex)) continue;
    const row = statementByIndex.get(candidate.statementIndex);
    if (row === undefined) continue;

    available.delete(candidate.statementIndex);
    line.statementIndex = candidate.statementIndex;
    line.statementAmount = row.amount;
    line.matchReason = reasonOf(candidate);
    billIdByStatement.set(candidate.statementIndex, line.id);

    if (!candidate.amountMatch) {
      // The deposit is the best one in the window but it is for another sum.
      line.status = STATUS.needsReview;
      continue;
    }
    if (!candidate.nameMatch && candidate.payerNamed) {
      // Right amount, someone else's name - usually a company paying for a guest.
      // A transfer that names nobody (QR PromptPay) is left unremarked.
      line.notes.push(NOTE.payerNameMismatch);
    }
    if (line.status !== STATUS.needsReview) line.status = STATUS.matched;
  }

  // No deposit inside the window - a human has to look at it.
  for (const index of openLines) {
    const line = draft[index];
    if (line !== undefined && line.statementIndex === null) line.status = STATUS.needsReview;
  }

  // Sheet 1 must look like the uploaded report, so the report's own order wins.
  const lines: MatchedLine[] = draft.map(toMatchedLine).sort((a, b) => a.sourceRow - b.sourceRow);

  const statement: AnnotatedStatementRow[] = input.statement.map((row) => ({
    ...row,
    billId: billIdByStatement.get(row.index) ?? null,
  }));

  const receiptsNotInReport = input.receipts
    .filter((receipt) => !usedReceiptIds.has(idKey(receipt.id)))
    .map((receipt) => receipt.id);

  return {
    year,
    years,
    lines,
    statement,
    counts: countLines(lines),
    receiptsNotInReport,
    duplicateReceiptIds: [...duplicates],
  };
}

interface DraftLine {
  readonly id: string;
  readonly datetime: Date;
  readonly time: string;
  readonly room: string | null;
  readonly customerName: string | null;
  readonly totalPaymentDue: number;
  readonly receiptAmount: number | null;
  readonly paymentInfo: string | null;
  readonly hasReceipt: boolean;
  readonly sourceRow: number;
  readonly notes: string[];
  status: MatchedLine["status"];
  statementAmount: number | null;
  statementIndex: number | null;
  matchReason: MatchReason | null;
}

function makeDraft(
  line: ReportLine,
  receipt: Receipt | null,
  amountTolerance: number,
  duplicated: boolean,
): DraftLine {
  const notes: string[] = [];
  // Two receipts claiming one document number means one id was misread. The
  // line must not come out green on the strength of a guess.
  if (receipt !== null && duplicated) notes.push(NOTE.duplicateReceipt);
  const receiptAmount = receipt?.totalPaymentDue ?? null;
  // The receipt's own total is only a cross-check; the report's amount is what
  // the deposit is matched against.
  const amountDisagrees =
    receiptAmount !== null && !amountsAgree(receiptAmount, line.totalPaymentDue, amountTolerance);
  if (amountDisagrees) notes.push(NOTE.amountMismatch);

  return {
    id: line.id,
    // The report has the date; only the receipt knows the time of day.
    datetime: receipt === null ? line.date : withTimeOf(line.date, receipt.datetime),
    time: receipt === null ? "" : formatTime(receipt.datetime),
    room: receipt?.room ?? line.room,
    customerName: line.customerName,
    totalPaymentDue: line.totalPaymentDue,
    receiptAmount,
    paymentInfo: receipt?.paymentInfo ?? null,
    hasReceipt: receipt !== null,
    sourceRow: line.sourceRow,
    notes,
    status:
      receipt === null
        ? STATUS.missingBill
        : amountDisagrees || duplicated
          ? STATUS.needsReview
          : STATUS.matched,
    statementAmount: null,
    statementIndex: null,
    matchReason: null,
  };
}

function toMatchedLine(line: DraftLine): MatchedLine {
  return {
    id: line.id,
    datetime: line.datetime,
    time: line.time,
    room: line.room,
    customerName: line.customerName,
    totalPaymentDue: line.totalPaymentDue,
    receiptAmount: line.receiptAmount,
    paymentInfo: line.paymentInfo,
    hasReceipt: line.hasReceipt,
    status: line.status,
    notes: line.notes,
    channel: classifyChannel(line.paymentInfo, false),
    statementAmount: line.statementAmount,
    statementIndex: line.statementIndex,
    matchReason: line.matchReason,
    sourceRow: line.sourceRow,
  };
}

function buildCandidates(
  draft: readonly DraftLine[],
  openLines: readonly number[],
  statement: readonly StatementRow[],
  toleranceMs: number,
  amountTolerance: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const lineIndex of openLines) {
    const line = draft[lineIndex];
    if (line === undefined) continue;
    for (const row of statement) {
      if (row.datetime === null) continue;
      const deltaMs = Math.abs(row.datetime.getTime() - line.datetime.getTime());
      if (deltaMs > toleranceMs) continue;
      out.push({
        lineIndex,
        statementIndex: row.index,
        nameMatch: detailNamesCustomer(row.detail, line.customerName),
        payerNamed: hasPayer(row.detail),
        amountMatch: amountsAgree(row.amount, line.totalPaymentDue, amountTolerance),
        deltaMs,
      });
    }
  }
  return out;
}

/** Business policy: name beats amount, amount beats time. */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
  if (a.amountMatch !== b.amountMatch) return a.amountMatch ? -1 : 1;
  if (a.deltaMs !== b.deltaMs) return a.deltaMs - b.deltaMs;
  if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
  return a.statementIndex - b.statementIndex;
}

function reasonOf(candidate: Candidate): MatchReason {
  if (candidate.nameMatch) return "name";
  if (candidate.amountMatch) return "amount";
  return "time";
}

function indexReceipts(receipts: readonly Receipt[]): Map<string, Receipt> {
  const map = new Map<string, Receipt>();
  // Last one wins, matching the per-company history dedupe rule.
  for (const receipt of receipts) map.set(idKey(receipt.id), receipt);
  return map;
}

/** Document numbers that came in on more than one receipt. */
function duplicateIds(receipts: readonly Receipt[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const receipt of receipts) {
    const key = idKey(receipt.id);
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return twice;
}

function idKey(id: string): string {
  return id.trim().toUpperCase();
}

/** The report's day, the receipt's time of day. */
function withTimeOf(day: Date, source: Date): Date {
  const msIntoDay =
    ((source.getUTCHours() * 60 + source.getUTCMinutes()) * 60 + source.getUTCSeconds()) * 1000;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + msIntoDay);
}

function formatTime(datetime: Date): string {
  const hours = String(datetime.getUTCHours()).padStart(2, "0");
  const minutes = String(datetime.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function countLines(lines: readonly MatchedLine[]): ReconcileCounts {
  const is = (status: MatchedLine["status"]) => lines.filter((l) => l.status === status).length;
  return {
    reportLines: lines.length,
    withReceipt: lines.filter((l) => l.hasReceipt).length,
    matched: is(STATUS.matched),
    needsReview: is(STATUS.needsReview),
    missingBill: is(STATUS.missingBill),
    withNotes: lines.filter((l) => l.notes.length > 0).length,
  };
}
