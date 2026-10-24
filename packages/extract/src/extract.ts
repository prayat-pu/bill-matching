import { parseReceiptRecords } from "@bill/core";
import type { Receipt, RejectedRow } from "@bill/core";
import { buildPrompt } from "./prompt.ts";
import { createGeminiClient, type VisionClient } from "./gemini.ts";
import { renderPdfPages, type RenderOptions, type RenderedPage } from "./render.ts";
import type { ExtractedReceipt } from "./schema.ts";

export interface ExtractOptions {
  readonly company: string;
  readonly client?: VisionClient;
  /** Images per model call. Handwriting reads best one page at a time. */
  readonly pagesPerCall?: number;
  readonly concurrency?: number;
  readonly render?: RenderOptions;
  readonly onProgress?: (progress: ExtractProgress) => void;
  /** Rasterizing a 20-page scan takes a while and reports nothing, so the UI
   *  needs to be told which of the two steps is running. */
  readonly onPhase?: (phase: ExtractPhase) => void;
}

export type ExtractPhase = "rendering" | "extracting";

export interface ExtractProgress {
  readonly pagesDone: number;
  readonly pagesTotal: number;
  readonly receiptsFound: number;
  readonly failures: number;
}

/** A call that failed. These pages produced nothing and must be shown to the
 *  user - they must never be mistaken for bills with no receipt. */
export interface PageFailure {
  readonly pages: readonly number[];
  readonly reason: string;
}

export interface ExtractResult {
  readonly pagesTotal: number;
  readonly raw: readonly (ExtractedReceipt & { readonly page: number })[];
  readonly receipts: readonly Receipt[];
  readonly rejected: readonly RejectedRow[];
  readonly failures: readonly PageFailure[];
  readonly model: string;
}

export async function extractReceiptsFromPdf(
  pdf: Buffer,
  options: ExtractOptions,
): Promise<ExtractResult> {
  options.onPhase?.("rendering");
  const pages = await renderPdfPages(pdf, options.render ?? {});
  return extractReceiptsFromPages(pages, options);
}

export async function extractReceiptsFromPages(
  pages: readonly RenderedPage[],
  options: ExtractOptions,
): Promise<ExtractResult> {
  const client = options.client ?? createGeminiClient();
  const prompt = buildPrompt(options.company);
  const chunks = chunk(pages, Math.max(1, options.pagesPerCall ?? 1));

  const raw: (ExtractedReceipt & { page: number })[] = [];
  const failures: PageFailure[] = [];
  let pagesDone = 0;

  const report = () =>
    options.onProgress?.({
      pagesDone,
      pagesTotal: pages.length,
      receiptsFound: raw.length,
      failures: failures.length,
    });

  // Say how many pages there are before the first call returns, so the bar can
  // stop guessing.
  options.onPhase?.("extracting");
  report();

  await mapWithConcurrency(chunks, Math.max(1, options.concurrency ?? 4), async (group) => {
    const numbers = group.map((p) => p.page);
    try {
      const found = await client.readReceipts(prompt, group.map((p) => p.jpeg));
      // One image per call means we know which page a receipt came from;
      // with several, we can only name the group.
      for (const receipt of found) raw.push({ ...receipt, page: numbers[0] ?? 0 });
    } catch (cause) {
      failures.push({ pages: numbers, reason: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      pagesDone += group.length;
      report();
    }
  });

  raw.sort((a, b) => a.page - b.page);
  // The model answers with `bank`; the core receipt record calls the field
  // `payment_info`, because for other companies it is cash or ZUZU, not a bank.
  const { rows, rejected } = parseReceiptRecords(
    raw.map((receipt) => ({ ...receipt, payment_info: receipt.bank })),
    "receipt extraction",
  );

  return { pagesTotal: pages.length, raw, receipts: rows, rejected, failures, model: client.model };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await run(item);
    }
  });
  await Promise.all(workers);
}
