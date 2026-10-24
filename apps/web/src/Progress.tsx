import { useEffect, useState } from "react";
import type { JobState, Phase } from "./api.ts";

/** The steps a run goes through, in order, as the page shows them. */
const STEPS: { phase: Phase; label: string; detail: string }[] = [
  { phase: "loading", label: "อ่านไฟล์ Excel", detail: "ตรวจรายงานบัญชีและ statement" },
  { phase: "rendering", label: "แปลง PDF เป็นรูป", detail: "ทีละหน้า ใช้เวลาสักครู่" },
  { phase: "extracting", label: "อ่านใบเสร็จด้วย AI", detail: "ขั้นนี้นานที่สุด" },
  { phase: "matching", label: "จับคู่กับ statement", detail: "หาเงินเข้าที่ตรงกัน" },
  { phase: "building", label: "สร้างไฟล์ Excel", detail: "ใส่สูตรและสี" },
];

const ORDER: Phase[] = ["queued", "loading", "rendering", "extracting", "matching", "building", "done"];

export function Progress({ state }: { readonly state: JobState }) {
  const now = useTicker(state.phase !== "done" && state.phase !== "failed");
  const current = ORDER.indexOf(state.phase);
  const counting = state.pagesTotal > 0;
  const percent = counting ? Math.round((state.pagesDone / state.pagesTotal) * 100) : 0;
  const elapsed = Math.max(0, Math.round((now - state.startedAt) / 1000));
  const quiet = Math.round((now - state.updatedAt) / 1000);

  return (
    <section className="progress">
      <ol className="steps">
        {STEPS.map((step) => {
          const index = ORDER.indexOf(step.phase);
          const done = state.phase === "done" || index < current;
          const active = index === current;
          return (
            <li key={step.phase} className={done ? "done" : active ? "active" : "waiting"}>
              <span className="mark" aria-hidden="true">
                {done ? "✓" : active ? <span className="spinner" /> : "•"}
              </span>
              <span className="text">
                <strong>{step.label}</strong>
                {active && <em>{step.detail}</em>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className={`bar${counting ? "" : " indeterminate"}`}>
        <div
          className={`fill${state.phase === "failed" ? " bad" : ""}`}
          style={counting ? { width: `${percent}%` } : undefined}
        />
      </div>

      <p className="numbers">
        {counting ? (
          <>
            <span>
              หน้า {state.pagesDone}/{state.pagesTotal}
            </span>
            <span>พบใบเสร็จ {state.receiptsFound}</span>
            {state.pagesDone > 0 && state.pagesDone < state.pagesTotal && (
              <span>เหลืออีกประมาณ {remaining(elapsed, state.pagesDone, state.pagesTotal)}</span>
            )}
          </>
        ) : (
          <span>กำลังเตรียมข้อมูล…</span>
        )}
        <span>ใช้เวลา {clock(elapsed)}</span>
        {state.failedCalls > 0 && <span className="warn">อ่านไม่ได้ {state.failedCalls} ครั้ง</span>}
      </p>

      {quiet > 90 && state.phase !== "done" && state.phase !== "failed" && (
        <p className="stalled">ไม่มีความคืบหน้ามา {clock(quiet)} — อาจช้าผิดปกติ ลองดู log ของเครื่องที่รันโปรแกรม</p>
      )}
    </section>
  );
}

/** Re-render once a second while the run is live, so the clock moves. */
function useTicker(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return now;
}

function remaining(elapsedSeconds: number, done: number, total: number): string {
  const perPage = elapsedSeconds / done;
  return clock(Math.round(perPage * (total - done)));
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} วิ`;
  return `${minutes} นาที ${String(rest).padStart(2, "0")} วิ`;
}

/** Shown while the files are still going up, before the job exists. */
export function Uploading({ fraction }: { readonly fraction: number }) {
  const percent = Math.round(fraction * 100);
  const sending = percent < 100;
  return (
    <section className="progress">
      <ol className="steps">
        <li className={sending ? "active" : "done"}>
          <span className="mark" aria-hidden="true">
            {sending ? <span className="spinner" /> : "✓"}
          </span>
          <span className="text">
            <strong>อัปโหลดไฟล์</strong>
            {sending && <em>ไฟล์สแกนมีขนาดใหญ่ รอสักครู่</em>}
          </span>
        </li>
        <li className={sending ? "waiting" : "active"}>
          <span className="mark" aria-hidden="true">
            {sending ? "•" : <span className="spinner" />}
          </span>
          <span className="text">
            <strong>เริ่มงาน</strong>
          </span>
        </li>
      </ol>
      <div className="bar">
        <div className="fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="numbers">
        <span>ส่งแล้ว {percent}%</span>
      </p>
    </section>
  );
}
