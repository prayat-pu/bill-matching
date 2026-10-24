import type { Summary } from "./api.ts";

export function Result({ summary, downloadUrl }: { readonly summary: Summary; readonly downloadUrl: string }) {
  const { counts, warnings } = summary;
  const warningCount =
    warnings.failedPages.length +
    warnings.rejectedReceipts.length +
    warnings.rejectedRows.length +
    warnings.receiptsNotInReport.length +
    warnings.duplicateReceiptIds.length +
    warnings.unsureBank.length;

  return (
    <section className="result">
      <div className="tiles">
        <Tile label="ยอดตรง" value={counts.matched} tone="good" />
        <Tile label="ตรวจสอบข้อมูล" value={counts.needsReview} tone="warn" />
        <Tile label="ขาดบิล" value={counts.missingBill} tone="bad" />
        <Tile label="มีหมายเหตุ" value={counts.withNotes} tone="plain" />
      </div>

      <p className="meta">
        รายงาน {counts.reportLines} บรรทัด · มีใบเสร็จ {counts.withReceipt} · statement{" "}
        {summary.statementDeposits} รายการฝาก · โมเดล {summary.model}
      </p>

      <a className="download" href={downloadUrl} download={summary.workbookName}>
        ดาวน์โหลด {summary.workbookName}
      </a>

      {warningCount > 0 && (
        <details className="warnings" open>
          <summary>ต้องตรวจด้วยตา ({warningCount})</summary>
          <WarningList title="อ่านใบเสร็จไม่สำเร็จ" items={warnings.failedPages.map((f) => `หน้า ${f.pages.join(", ")}: ${f.reason}`)} />
          <WarningList title="ใบเสร็จที่ข้อมูลไม่ครบ" items={warnings.rejectedReceipts.map((r) => `${r.source} #${r.row}: ${r.reason}`)} />
          <WarningList title="แถวในไฟล์ที่อ่านไม่ได้" items={warnings.rejectedRows.map((r) => `${r.source} แถว ${r.row}: ${r.reason}`)} />
          <WarningList title="ใบเสร็จที่ไม่มีในรายงาน" items={warnings.receiptsNotInReport} />
          <WarningList title="เลขที่เอกสารซ้ำ (อ่านเลขผิด)" items={warnings.duplicateReceiptIds} />
          <WarningList title="ไม่มั่นใจว่าติ๊กธนาคารไหน" items={warnings.unsureBank} />
        </details>
      )}
    </section>
  );
}

function WarningList({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="warning-group">
      <h3>
        {title} <span>({items.length})</span>
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ label, value, tone }: { readonly label: string; readonly value: number; readonly tone: string }) {
  return (
    <div className={`tile ${tone}`}>
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}
