import { describe, expect, it } from "vitest";
import { extractReceiptsFromPages } from "../src/extract.ts";
import { buildPrompt, layoutForCompany } from "../src/prompt.ts";
import type { VisionClient } from "../src/gemini.ts";
import type { ExtractedReceipt } from "../src/schema.ts";
import type { RenderedPage } from "../src/render.ts";

function page(n: number): RenderedPage {
  return { page: n, jpeg: Buffer.from(`page-${n}`), width: 100, height: 100 };
}

function receipt(id: string, over: Partial<ExtractedReceipt> = {}): ExtractedReceipt {
  return {
    id,
    date: "01/05/2026",
    time: "09:24",
    room: "C23",
    total_payment_due: "749.00",
    slip_date: "1/5/69",
    marked_box: "upper",
    bank: "ธ.กรุงไทย",
    bank_confidence: "sure",
    customer_name: "เตชิต ทินภัทรธรรเณศ",
    company: "44 Residence",
    ...over,
  };
}

function fakeClient(handler: (images: readonly Buffer[]) => ExtractedReceipt[] | Promise<never>): VisionClient {
  return { model: "fake", readReceipts: async (_prompt, images) => handler(images) };
}

describe("extraction over rendered pages", () => {
  it("turns one call per page into core receipts", async () => {
    const calls: number[] = [];
    const client = fakeClient((images) => {
      calls.push(images.length);
      return [receipt(`RCD20260500000${calls.length}`)];
    });

    const result = await extractReceiptsFromPages([page(1), page(2), page(3)], {
      company: "44 Residence",
      client,
      concurrency: 1,
    });

    expect(calls).toEqual([1, 1, 1]);
    expect(result.receipts).toHaveLength(3);
    expect(result.receipts[0]!.datetime.toISOString()).toBe("2026-05-01T09:24:00.000Z");
    expect(result.receipts[0]!.totalPaymentDue).toBe(74900);
    expect(result.receipts[0]!.paymentInfo).toBe("ธ.กรุงไทย");
    expect(result.failures).toHaveLength(0);
  });

  it("batches pages when asked", async () => {
    const sizes: number[] = [];
    const client = fakeClient((images) => {
      sizes.push(images.length);
      return [];
    });
    await extractReceiptsFromPages([page(1), page(2), page(3)], {
      company: "44 Residence",
      client,
      pagesPerCall: 2,
      concurrency: 1,
    });
    expect(sizes).toEqual([2, 1]);
  });

  it("reports a failed call instead of silently losing the pages", async () => {
    let seen = 0;
    const client = fakeClient(() => {
      seen += 1;
      if (seen === 2) return Promise.reject(new Error("503 overloaded"));
      return [receipt(`RCD2026050000${seen}`)];
    });

    const result = await extractReceiptsFromPages([page(1), page(2)], {
      company: "44 Residence",
      client,
      concurrency: 1,
    });

    expect(result.receipts).toHaveLength(1);
    expect(result.failures).toEqual([{ pages: [2], reason: "503 overloaded" }]);
  });

  it("quarantines a record the model got wrong", async () => {
    const client = fakeClient(() => [receipt("RCD202605000001", { date: "" })]);
    const result = await extractReceiptsFromPages([page(1)], { company: "44 Residence", client });
    expect(result.receipts).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it("reports progress as pages finish, starting from zero", async () => {
    const seen: number[] = [];
    const client = fakeClient(() => [receipt("RCD202605000001")]);
    await extractReceiptsFromPages([page(1), page(2)], {
      company: "44 Residence",
      client,
      concurrency: 1,
      onProgress: (p) => seen.push(p.pagesDone),
    });
    // The first report says 0/2, so the bar knows the total before the first
    // call comes back.
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe("prompt", () => {
  it("picks the bank-checkbox layout for Residence and House", () => {
    expect(layoutForCompany("44 Residence")).toBe("bank-checkbox");
    expect(layoutForCompany("44 เฮ้า")).toBe("bank-checkbox");
    expect(layoutForCompany("44 Room")).toBe("method-list");
  });

  it("explains the two bank checkboxes for Residence", () => {
    const prompt = buildPrompt("44 Residence");
    expect(prompt).toContain("ธ.กรุงไทย");
    expect(prompt).toContain("ธ.กรุงศรี");
    expect(prompt).toContain("69");
  });
});
