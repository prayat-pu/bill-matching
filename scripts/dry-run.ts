/**
 * End-to-end check against the files in raw/: load the report and the
 * statement, feed in a JSON file of extracted receipts, reconcile, and print
 * what happened. No workbook, no UI - just the numbers.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadReportFile,
  loadStatementFile,
  parseReceiptRecords,
  reconcile,
  toBaht,
} from "../packages/core/src/index.ts";

const [reportPath, statementPath, receiptsPath] = process.argv.slice(2);
if (reportPath === undefined || statementPath === undefined || receiptsPath === undefined) {
  throw new Error("usage: npm run dry-run -- <report.xlsx> <statement.xlsx> <extracted.json>");
}

const report = await loadReportFile(await readFile(resolve(reportPath)));
const statement = await loadStatementFile(await readFile(resolve(statementPath)));
const extracted = JSON.parse(await readFile(resolve(receiptsPath), "utf8")) as {
  receipts: { bank?: string }[];
};
// The extractor calls the field `bank`; the core record calls it `payment_info`.
const receipts = parseReceiptRecords(extracted.receipts.map((r) => ({ ...r, payment_info: r.bank })));

console.log(
  `report ${report.rows.length} lines (${report.rejected.length} rejected), ` +
    `statement ${statement.rows.length} deposits, ` +
    `receipts ${receipts.rows.length} (${receipts.rejected.length} rejected)`,
);

const result = reconcile({
  company: "44 Residence",
  report: report.rows,
  statement: statement.rows,
  receipts: receipts.rows,
});

console.log("\ncounts", result.counts);
if (result.duplicateReceiptIds.length > 0) {
  console.log("document numbers on more than one receipt:", result.duplicateReceiptIds.join(", "));
}
if (result.receiptsNotInReport.length > 0) {
  console.log("receipts with no report line:", result.receiptsNotInReport.join(", "));
}

console.log("\nthe lines that have a receipt");
for (const line of result.lines.filter((l) => l.hasReceipt)) {
  const deposit =
    line.statementIndex === null
      ? "no deposit"
      : `deposit #${line.statementIndex} ${toBaht(line.statementAmount ?? 0)} by ${line.matchReason}`;
  console.log(
    `  ${line.id}  ${line.datetime.toISOString().slice(0, 16).replace("T", " ")}  ` +
      `${String(toBaht(line.totalPaymentDue)).padStart(9)}  ${line.status.padEnd(14)} ${deposit}` +
      (line.notes.length > 0 ? `  | ${line.notes.join(" / ")}` : ""),
  );
}
