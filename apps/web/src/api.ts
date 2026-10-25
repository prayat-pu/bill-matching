/** The shapes the server sends. Kept in step with apps/server/src/jobs.ts. */

export const COMPANIES = ["44 Residence", "44 House", "44 Room", "44 Home"] as const;
export type Company = (typeof COMPANIES)[number];

export type Phase =
  | "queued"
  | "loading"
  | "rendering"
  | "extracting"
  | "matching"
  | "building"
  | "done"
  | "failed";

export interface Counts {
  reportLines: number;
  withReceipt: number;
  matched: number;
  needsReview: number;
  missingBill: number;
  overpaid: number;
  underpaid: number;
  cancelled: number;
  withNotes: number;
}

export interface RejectedRow {
  source: string;
  row: number;
  reason: string;
}

export interface Warnings {
  failedPages: { pages: number[]; reason: string }[];
  rejectedReceipts: RejectedRow[];
  rejectedRows: RejectedRow[];
  receiptsNotInReport: string[];
  duplicateReceiptIds: string[];
  needsReview: string[];
}

export interface Summary {
  jobId: string;
  company: Company;
  model: string;
  counts: Counts;
  statementDeposits: number;
  warnings: Warnings;
  workbookName: string;
}

export interface JobState {
  phase: Phase;
  pagesDone: number;
  pagesTotal: number;
  receiptsFound: number;
  failedCalls: number;
  /** Epoch ms, from the server, for the elapsed clock and the stall warning. */
  startedAt: number;
  updatedAt: number;
  error: string | null;
  summary: Summary | null;
}

export interface StartInput {
  company: Company;
  report: File;
  statement: File;
  receipts: File[];
}

/**
 * Upload and start a run. A scan is tens of megabytes, so the upload itself
 * takes a visible moment - XMLHttpRequest is used because fetch cannot report
 * upload progress.
 */
export function startJob(input: StartInput, onUpload?: (fraction: number) => void): Promise<string> {
  const form = new FormData();
  form.set("company", input.company);
  form.set("report", input.report);
  form.set("statement", input.statement);
  for (const file of input.receipts) form.append("receipts", file);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/jobs");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onUpload?.(event.loaded / event.total);
    };
    request.onerror = () => reject(new Error("could not reach the server"));
    request.onload = () => {
      let body: { jobId?: string; error?: string } = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        reject(new Error(`the server answered ${request.status}`));
        return;
      }
      if (request.status >= 400 || body.jobId === undefined) {
        reject(new Error(body.error ?? `the server answered ${request.status}`));
        return;
      }
      resolve(body.jobId);
    };
    request.send(form);
  });
}

/** Follow a run. Returns a function that stops listening. */
export function watchJob(jobId: string, onState: (state: JobState) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (event) => {
    const state = JSON.parse(event.data as string) as JobState;
    onState(state);
    if (state.phase === "done" || state.phase === "failed") source.close();
  };
  source.onerror = () => source.close();
  return () => source.close();
}

export function workbookUrl(jobId: string): string {
  return `/api/jobs/${jobId}/workbook`;
}
