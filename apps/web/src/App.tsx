import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMPANIES, startJob, watchJob, workbookUrl } from "./api.ts";
import type { Company, JobState } from "./api.ts";
import { FilePicker } from "./FilePicker.tsx";
import { Progress, Uploading } from "./Progress.tsx";
import { Result } from "./Result.tsx";

export function App() {
  const [company, setCompany] = useState<Company>("44 Residence");
  const [receipts, setReceipts] = useState<File[]>([]);
  const [report, setReport] = useState<File[]>([]);
  const [statement, setStatement] = useState<File[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const ready = receipts.length > 0 && report.length === 1 && statement.length === 1;
  const running =
    uploaded !== null || (state !== null && state.phase !== "done" && state.phase !== "failed");

  useEffect(() => () => stopRef.current?.(), []);

  const run = useCallback(async () => {
    if (!ready || running) return;
    setError(null);
    setState(null);
    setUploaded(0);
    stopRef.current?.();
    try {
      const id = await startJob(
        { company, report: report[0]!, statement: statement[0]!, receipts },
        setUploaded,
      );
      setJobId(id);
      stopRef.current = watchJob(id, setState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploaded(null);
    }
  }, [company, ready, receipts, report, running, statement]);

  const hint = useMemo(() => {
    if (receipts.length === 0) return "ยังไม่ได้เลือกไฟล์ PDF ใบเสร็จ";
    if (report.length !== 1) return "ยังไม่ได้เลือกรายงานบัญชี";
    if (statement.length !== 1) return "ยังไม่ได้เลือก statement ธนาคาร";
    return null;
  }, [receipts, report, statement]);

  return (
    <main>
      <header>
        <h1>กระทบยอดใบเสร็จ</h1>
        <p>อัปโหลดใบเสร็จ รายงานบัญชี และ statement ธนาคาร แล้วรับไฟล์ Excel กลับไปหนึ่งไฟล์</p>
      </header>

      <section className="company">
        <label htmlFor="company">บริษัท</label>
        <select
          id="company"
          value={company}
          disabled={running}
          onChange={(event) => setCompany(event.target.value as Company)}
        >
          {COMPANIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </section>

      <section className="pickers">
        <FilePicker
          title="1 · ใบเสร็จ (PDF)"
          hint="สแกนใบเสร็จ หนึ่งใบต่อหนึ่งหน้า เลือกได้หลายไฟล์"
          accept="application/pdf"
          multiple
          files={receipts}
          disabled={running}
          onChange={setReceipts}
        />
        <FilePicker
          title="2 · รายงานบัญชี (.xlsx)"
          hint="หัวตารางอยู่แถวที่ 5"
          accept=".xlsx"
          files={report}
          disabled={running}
          onChange={setReport}
        />
        <FilePicker
          title="3 · Statement ธนาคาร (.xlsx)"
          hint="หัวตารางอยู่แถวที่ 8"
          accept=".xlsx"
          files={statement}
          disabled={running}
          onChange={setStatement}
        />
      </section>

      <section className="run">
        <button type="button" onClick={run} disabled={!ready || running}>
          {running ? "กำลังทำงาน…" : "เริ่มกระทบยอด"}
        </button>
        {hint !== null && <span className="hint">{hint}</span>}
      </section>

      {error !== null && <p className="error">{error}</p>}
      {uploaded !== null && state === null && <Uploading fraction={uploaded} />}
      {state !== null && <Progress state={state} />}
      {state?.phase === "failed" && <p className="error">{state.error ?? "ทำงานไม่สำเร็จ"}</p>}
      {state?.summary != null && jobId !== null && (
        <Result summary={state.summary} downloadUrl={workbookUrl(jobId)} />
      )}
    </main>
  );
}
