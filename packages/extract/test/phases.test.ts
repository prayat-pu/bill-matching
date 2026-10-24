import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractReceiptsFromPdf } from "../src/extract.ts";
import type { ExtractPhase } from "../src/extract.ts";
import type { VisionClient } from "../src/gemini.ts";

const PDF = new URL("../../../raw/receipts_residence_1-25.pdf", import.meta.url).pathname;

/** Answers instantly - this test is about the phases, not the model. */
const silentClient: VisionClient = { model: "fake", readReceipts: async () => [] };

describe.skipIf(!existsSync(PDF))("phases reported while reading a real PDF", () => {
  it("says it is rendering before it says it is extracting", async () => {
    const phases: ExtractPhase[] = [];
    let firstProgress: { pagesDone: number; pagesTotal: number } | null = null;

    await extractReceiptsFromPdf(await readFile(PDF), {
      company: "44 Residence",
      client: silentClient,
      // Small and quick; the image quality does not matter here.
      render: { dpi: 20 },
      onPhase: (phase) => phases.push(phase),
      onProgress: (progress) => {
        firstProgress ??= { pagesDone: progress.pagesDone, pagesTotal: progress.pagesTotal };
      },
    });

    expect(phases).toEqual(["rendering", "extracting"]);
    // The page count is known before the first call comes back, so the bar can
    // switch from "working on it" to a real percentage straight away.
    expect(firstProgress).toEqual({ pagesDone: 0, pagesTotal: 20 });
  }, 60_000);
});
