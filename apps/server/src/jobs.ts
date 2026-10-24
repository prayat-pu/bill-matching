import { randomUUID } from "node:crypto";
import {
  loadReportFile,
  loadStatementFile,
  parseReceiptRecords,
  reconcile,
} from "@bill/core";
import type { Company, ReconcileCounts, RejectedRow } from "@bill/core";
import { extractReceiptsFromPdf } from "@bill/extract";
import type { ExtractResult } from "@bill/extract";
import { buildWorkbook } from "@bill/workbook";

export type Phase =
  | "queued"
  | "loading"
  | "rendering"
  | "extracting"
  | "matching"
  | "building"
  | "done"
  | "failed";

export interface JobProgress {
  readonly phase: Phase;
  readonly pagesDone: number;
  readonly pagesTotal: number;
  readonly receiptsFound: number;
  readonly failedCalls: number;
  /** Epoch ms the run started, so the page can show a ticking clock. */
  readonly startedAt: number;
  /** Epoch ms of this update, so a stalled run is visible. */
  readonly updatedAt: number;
}

/** Everything the accountant has to look at by hand. */
export interface Warnings {
  /** Model calls that failed. These pages produced nothing - never ขาดบิล. */
  readonly failedPages: readonly { pages: readonly number[]; reason: string }[];
  /** Records the model returned that did not fit the schema. */
  readonly rejectedReceipts: readonly RejectedRow[];
  /** Rows of the uploaded sheets that could not be read. */
  readonly rejectedRows: readonly RejectedRow[];
  /** Receipts whose document number is in no report line. */
  readonly receiptsNotInReport: readonly string[];
  /** Document numbers that two receipts claimed - one of them was misread. */
  readonly duplicateReceiptIds: readonly string[];
  /** Receipts where the model was unsure which bank checkbox was ticked. */
  readonly unsureBank: readonly string[];
}

export interface JobSummary {
  readonly jobId: string;
  readonly company: Company;
  readonly model: string;
  readonly counts: ReconcileCounts;
  readonly statementDeposits: number;
  readonly warnings: Warnings;
  readonly workbookName: string;
}

export interface Job {
  readonly id: string;
  progress: JobProgress;
  summary: JobSummary | null;
  workbook: Buffer | null;
  error: string | null;
  readonly createdAt: number;
  readonly listeners: Set<(job: Job) => void>;
}

export interface JobInput {
  readonly company: Company;
  readonly reportFile: { name: string; data: Buffer };
  readonly statementFile: { name: string; data: Buffer };
  readonly receiptFiles: readonly { name: string; data: Buffer }[];
}

const JOB_TTL_MS = 30 * 60 * 1000;

export class JobStore {
  readonly #jobs = new Map<string, Job>();

  get(id: string): Job | undefined {
    return this.#jobs.get(id);
  }

  /** Starts the work and returns at once; the caller polls or listens. */
  start(input: JobInput): Job {
    this.#sweep();
    const job: Job = {
      id: randomUUID(),
      progress: {
        phase: "queued",
        pagesDone: 0,
        pagesTotal: 0,
        receiptsFound: 0,
        failedCalls: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      },
      summary: null,
      workbook: null,
      error: null,
      createdAt: Date.now(),
      listeners: new Set(),
    };
    this.#jobs.set(job.id, job);
    void run(job, input).catch((cause: unknown) => {
      job.error = cause instanceof Error ? cause.message : String(cause);
      update(job, { phase: "failed" });
    });
    return job;
  }

  #sweep(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.#jobs) {
      if (job.createdAt < cutoff) this.#jobs.delete(id);
    }
  }
}

function update(job: Job, patch: Partial<JobProgress>): void {
  job.progress = { ...job.progress, ...patch, updatedAt: Date.now() };
  for (const listener of job.listeners) listener(job);
}

async function run(job: Job, input: JobInput): Promise<void> {
  update(job, { phase: "loading" });

  // Fail at the boundary, with the real cause, before paying for extraction.
  const report = await loadReportFile(input.reportFile.data, input.reportFile.name);
  const statement = await loadStatementFile(input.statementFile.data, input.statementFile.name);

  update(job, { phase: "extracting" });

  const extractions: ExtractResult[] = [];
  let pagesBefore = 0;
  for (const file of input.receiptFiles) {
    // Counts carry over from the files already done, so a second PDF does not
    // reset the bar. pagesTotal only grows once a file has been rasterized.
    const doneBefore = pagesBefore;
    const receiptsBefore = countReceipts(extractions);
    const failuresBefore = countFailures(extractions);

    const extraction = await extractReceiptsFromPdf(file.data, {
      company: input.company,
      // Rasterizing happens before any page can be read; say so, or the bar
      // sits at zero for a minute and looks stuck.
      onPhase: (phase) => update(job, { phase: phase === "rendering" ? "rendering" : "extracting" }),
      onProgress: (progress) =>
        update(job, {
          pagesDone: doneBefore + progress.pagesDone,
          pagesTotal: doneBefore + progress.pagesTotal,
          receiptsFound: receiptsBefore + progress.receiptsFound,
          failedCalls: failuresBefore + progress.failures,
        }),
    });
    extractions.push(extraction);
    pagesBefore += extraction.pagesTotal;
  }

  update(job, { phase: "matching" });

  const receiptRecords = extractions.flatMap((e) => e.raw.map((r) => ({ ...r, payment_info: r.bank })));
  const receipts = parseReceiptRecords(receiptRecords, "receipt extraction");

  const result = reconcile({
    company: input.company,
    report: report.rows,
    statement: statement.rows,
    receipts: receipts.rows,
  });

  update(job, { phase: "building" });

  job.workbook = await buildWorkbook({
    result,
    report: report.sheet,
    statement: statement.sheet,
    company: input.company,
  });
  job.summary = {
    jobId: job.id,
    company: input.company,
    model: extractions[0]?.model ?? "",
    counts: result.counts,
    statementDeposits: statement.rows.length,
    warnings: {
      failedPages: extractions.flatMap((e) => e.failures.map((f) => ({ pages: f.pages, reason: f.reason }))),
      rejectedReceipts: [...extractions.flatMap((e) => e.rejected), ...receipts.rejected],
      rejectedRows: [...report.rejected, ...statement.rejected],
      receiptsNotInReport: result.receiptsNotInReport,
      duplicateReceiptIds: result.duplicateReceiptIds,
      unsureBank: extractions.flatMap((e) => e.raw.filter((r) => r.bank_confidence === "unsure").map((r) => r.id)),
    },
    workbookName: workbookName(input.company),
  };

  update(job, { phase: "done" });
}

function countReceipts(extractions: readonly ExtractResult[]): number {
  return extractions.reduce((total, e) => total + e.raw.length, 0);
}

function countFailures(extractions: readonly ExtractResult[]): number {
  return extractions.reduce((total, e) => total + e.failures.length, 0);
}

function workbookName(company: Company): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `matching-${company.replace(/\s+/g, "-").toLowerCase()}-${stamp}.xlsx`;
}
