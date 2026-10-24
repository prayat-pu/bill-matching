import { describe, expect, it } from "vitest";
import { reconcile } from "../src/match/reconcile.ts";
import { NOTE, STATUS } from "../src/domain.ts";
import { receipt, reportLine, statementRow } from "./helpers.ts";

const company = "44 Residence" as const;

describe("step 1 - join on the document number alone", () => {
  it("joins even when the receipt's own date differs from the report's", () => {
    const result = reconcile({
      company,
      report: [reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900 })],
      statement: [],
      receipts: [receipt({ id: "RCD2026-1", date: "01/12/2026", time: "09:24" })],
    });
    expect(result.lines[0]!.hasReceipt).toBe(true);
    // The report's day, the receipt's time of day.
    expect(result.lines[0]!.datetime.toISOString()).toBe("2026-12-03T09:24:00.000Z");
    expect(result.lines[0]!.time).toBe("09:24");
  });

  it("marks a report line with no receipt as missing, with no time", () => {
    const result = reconcile({
      company,
      report: [reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900 })],
      statement: [],
      receipts: [],
    });
    expect(result.lines[0]!.status).toBe(STATUS.missingBill);
    expect(result.lines[0]!.time).toBe("");
  });

  it("reports a receipt whose id is in no report line instead of dropping it", () => {
    const result = reconcile({
      company,
      report: [reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900 })],
      statement: [],
      receipts: [receipt({ id: "RCD2026-9", date: "03/12/2026", time: "09:24" })],
    });
    expect(result.receiptsNotInReport).toEqual(["RCD2026-9"]);
  });

  it("refuses to trust a document number that two receipts claim", () => {
    const result = reconcile({
      company,
      report: [reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900 })],
      statement: [statementRow(0, { date: "03/12/2026", time: "09:24", amount: 74900 })],
      receipts: [
        receipt({ id: "RCD2026-1", date: "03/12/2026", time: "09:24" }),
        receipt({ id: "rcd2026-1", date: "03/12/2026", time: "16:14" }),
      ],
    });
    expect(result.duplicateReceiptIds).toEqual(["RCD2026-1"]);
    expect(result.lines[0]!.notes).toContain(NOTE.duplicateReceipt);
    expect(result.lines[0]!.status).toBe(STATUS.needsReview);
  });

  it("keeps the report's own row order", () => {
    const result = reconcile({
      company,
      report: [
        reportLine({ id: "RCD2026-1", date: "05/12/2026", totalPaymentDue: 100, sourceRow: 6 }),
        reportLine({ id: "RCD2026-2", date: "01/12/2026", totalPaymentDue: 100, sourceRow: 7 }),
      ],
      statement: [],
      receipts: [receipt({ id: "RCD2026-2", date: "01/12/2026", time: "09:00" })],
    });
    expect(result.lines.map((l) => l.id)).toEqual(["RCD2026-1", "RCD2026-2"]);
  });
});

describe("step 2 - the receipt total against the report total", () => {
  const report = [reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900 })];

  it("says nothing when they agree", () => {
    const result = reconcile({
      company,
      report,
      statement: [statementRow(0, { date: "03/12/2026", time: "09:24", amount: 74900 })],
      receipts: [receipt({ id: "RCD2026-1", date: "03/12/2026", time: "09:24", totalPaymentDue: 74900 })],
    });
    expect(result.lines[0]!.notes).toEqual([]);
    expect(result.lines[0]!.status).toBe(STATUS.matched);
  });

  it("notes the disagreement and asks for review", () => {
    const result = reconcile({
      company,
      report,
      statement: [statementRow(0, { date: "03/12/2026", time: "09:24", amount: 74900 })],
      receipts: [receipt({ id: "RCD2026-1", date: "03/12/2026", time: "09:24", totalPaymentDue: 70000 })],
    });
    expect(result.lines[0]!.notes).toEqual([NOTE.amountMismatch]);
    expect(result.lines[0]!.status).toBe(STATUS.needsReview);
    // The report's amount is still the one that was matched.
    expect(result.lines[0]!.totalPaymentDue).toBe(74900);
    expect(result.lines[0]!.statementAmount).toBe(74900);
  });
});

describe("step 3 - the bank deposit", () => {
  const report = [
    reportLine({
      id: "RCD2026-1",
      date: "03/12/2026",
      totalPaymentDue: 74900,
      customerName: "สิริวิชญ์ ดีคล้าย",
    }),
  ];
  const receipts = [receipt({ id: "RCD2026-1", date: "03/12/2026", time: "09:24" })];
  const payer = "รับโอนเงิน\nSCB นาย สิริวิชญ์ ดีคล้าย\nบัญชีต้นทาง : X1";

  it("matches on amount and name", () => {
    const result = reconcile({
      company,
      report,
      statement: [statementRow(0, { date: "03/12/2026", time: "09:25", amount: 74900, detail: payer })],
      receipts,
    });
    expect(result.lines[0]!.status).toBe(STATUS.matched);
    expect(result.lines[0]!.notes).toEqual([]);
    expect(result.statement[0]!.billId).toBe("RCD2026-1");
  });

  it("passes a company paying for a guest, with a note", () => {
    const result = reconcile({
      company,
      report,
      statement: [
        statementRow(0, {
          date: "03/12/2026",
          time: "09:25",
          amount: 74900,
          detail: "รับโอนเงิน\nSCB บริษัท ดวงเจริญ จำกัด\nบัญชีต้นทาง : X1",
        }),
      ],
      receipts,
    });
    expect(result.lines[0]!.status).toBe(STATUS.matched);
    expect(result.lines[0]!.notes).toEqual([NOTE.payerNameMismatch]);
  });

  it("asks for review when the deposit is for another sum", () => {
    const result = reconcile({
      company,
      report,
      statement: [statementRow(0, { date: "03/12/2026", time: "09:25", amount: 70000, detail: payer })],
      receipts,
    });
    expect(result.lines[0]!.status).toBe(STATUS.needsReview);
    expect(result.lines[0]!.statementAmount).toBe(70000);
  });

  it("looks two minutes either way, and no further", () => {
    const inside = reconcile({
      company,
      report,
      statement: [statementRow(0, { date: "03/12/2026", time: "09:26", amount: 74900, detail: payer })],
      receipts,
    });
    expect(inside.lines[0]!.status).toBe(STATUS.matched);

    const outside = reconcile({
      company,
      report,
      statement: [statementRow(0, { date: "03/12/2026", time: "09:27", amount: 74900, detail: payer })],
      receipts,
    });
    expect(outside.lines[0]!.status).toBe(STATUS.needsReview);
    expect(outside.lines[0]!.statementIndex).toBeNull();
    expect(outside.statement[0]!.billId).toBeNull();
  });

  it("prefers the named payer over the closer deposit", () => {
    const result = reconcile({
      company,
      report,
      statement: [
        statementRow(0, { date: "03/12/2026", time: "09:24", amount: 74900, detail: "รับโอนเงิน\nSCB นาย อื่น ใคร" }),
        statementRow(1, { date: "03/12/2026", time: "09:25", amount: 74900, detail: payer }),
      ],
      receipts,
    });
    expect(result.lines[0]!.statementIndex).toBe(1);
    expect(result.lines[0]!.matchReason).toBe("name");
  });

  it("gives one deposit to one bill only", () => {
    const result = reconcile({
      company,
      report: [
        reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900, sourceRow: 6 }),
        reportLine({ id: "RCD2026-2", date: "03/12/2026", totalPaymentDue: 74900, sourceRow: 7 }),
      ],
      statement: [statementRow(0, { date: "03/12/2026", time: "09:24", amount: 74900 })],
      receipts: [
        receipt({ id: "RCD2026-1", date: "03/12/2026", time: "09:24" }),
        receipt({ id: "RCD2026-2", date: "03/12/2026", time: "09:24" }),
      ],
    });
    expect(result.lines.filter((l) => l.statementIndex !== null)).toHaveLength(1);
    expect(result.counts.matched).toBe(1);
    expect(result.counts.needsReview).toBe(1);
  });

  it("ignores a statement row whose date could not be read", () => {
    const result = reconcile({
      company,
      report,
      statement: [{ index: 0, datetime: null, amount: 74900, detail: payer, sourceRow: 9 }],
      receipts,
    });
    expect(result.lines[0]!.status).toBe(STATUS.needsReview);
  });
});

describe("counts", () => {
  it("counts every status over report lines", () => {
    const result = reconcile({
      company,
      report: [
        reportLine({ id: "RCD2026-1", date: "03/12/2026", totalPaymentDue: 74900, sourceRow: 6 }),
        reportLine({ id: "RCD2026-2", date: "03/12/2026", totalPaymentDue: 74900, sourceRow: 7 }),
        reportLine({ id: "RCD2026-3", date: "03/12/2026", totalPaymentDue: 74900, sourceRow: 8 }),
      ],
      statement: [statementRow(0, { date: "03/12/2026", time: "09:24", amount: 74900 })],
      receipts: [
        receipt({ id: "RCD2026-1", date: "03/12/2026", time: "09:24" }),
        receipt({ id: "RCD2026-2", date: "03/12/2026", time: "15:00", totalPaymentDue: 1 }),
      ],
    });
    expect(result.counts).toEqual({
      reportLines: 3,
      withReceipt: 2,
      matched: 1,
      needsReview: 1,
      missingBill: 1,
      withNotes: 1,
    });
    expect(result.year).toBe("2026");
  });
});
