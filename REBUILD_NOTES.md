# Rebuild Notes — Bill Reconciliation Center

Everything needed to rebuild this app on a different stack. The business rules
below are the product; the Python/pandas/Streamlit choices are not. Read this
with `README.md` (what the current app does) beside it.

> **Status: the rebuild is done** — TypeScript, React and Fastify, see
> `README.md`. These notes are kept as the record of the original Python tool
> and of why each rule exists. Where the rebuild deliberately departs from
> them, it is listed under "What the rebuild changed" at the bottom.

---

## 1. What the app is, in one paragraph

A back-office tool for the 44 Group residences. Someone has a stack of scanned
paper receipts, an accounting report of what should have been collected, and a
bank statement of what actually arrived. The app reads the receipts with a
vision LLM, lines all three sources up, and produces one Excel workbook where
every report line is marked matched / needs-review / missing-receipt, with
payments split by channel and subtotaled by document-number prefix. The
accountant then works *inside* that workbook — it is not a read-only report.

Four separate companies share the tool: **44 Residence, 44 House, 44 Room,
44 Home**. Each is reconciled independently; data never crosses between them.

---

## 2. Data contracts (keep these exactly)

These come from systems you do not control. Changing them means changing the
accountant's export habits, so port them verbatim.

### 2a. Accounting report — `.xlsx`
Real header row is the **5th** row (skip 4). Thai headers, mapped to:

| Header in file | Field |
|---|---|
| `วันที่` | `date` |
| `เลขที่เอกสาร` | `id` (document number) |
| `ห้อง` | `room` |
| `รวมสุทธิ` | `total_payment_due` |
| `ชื่อลูกค้า` | `customer_name` |

Rows with an empty `id` are dropped. Dates are **day-first** (`DD/MM/YYYY`).

There is also a `สถานะ` (status) column used for cancellation detection —
if it contains `ยกเลิก`, the bill is cancelled.

### 2b. Bank statement — `.xlsx`
Real header row is the **8th** row (skip 7).

| Header in file | Field |
|---|---|
| `วันที่/เวลา` | `datetime` |
| `ฝาก` (deposit) | `statement_amount` |
| `คำอธิบายรายละเอียด` | `detail` (free text, contains payer name) |

Gotchas, all load-bearing:
- the datetime cell contains a literal **newline** between date and time — strip it
- day-first again
- amounts are strings with **thousands commas** — strip before parsing
- rows with no deposit amount are dropped; rows with an unparseable datetime
  are dropped at match time

### 2c. Receipt record (LLM output)
One JSON object per receipt; a file may contain many:

```json
{"id":"...", "date":"...", "room":"...", "time":"...",
 "total_payment_due":"...", "bank":"...", "company":"..."}
```

`date` + `time` are concatenated and parsed day-first into one `datetime`.
`total_payment_due` arrives as a string with commas.

### 2d. Document-number prefixes
`id` encodes the charge type and drives the workbook's subtotals:

| Prefix | Meaning |
|---|---|
| `RA2026` | ค่าปรับ/ค่าบริการ — penalties / services |
| `RB2026` | เงินจอง — booking deposit |
| `RC2026` | รายเดือน — monthly |
| `RD2026` | ค่าประกัน — security deposit |
| `RI2026` | รายอาทิตย์ — weekly |
| `RO2026` | ย้ายออก — move-out |
| `RCD2026` | รายวัน — daily |

**Trap:** `RC2026*` as a prefix match also catches `RCD2026*`. Every monthly
subtotal must explicitly exclude `RCD2026*`. The year is hardcoded in the
current code — make it a config value or derive it from the data.

---

## 3. The reconciliation algorithm (the actual product)

Port this step for step; the ordering of the tie-breakers is business policy,
not an implementation detail.

**Step 1 — join receipts to the report.**
Join on the pair `(date, id)`. It is a **right join**: every report line
survives even with no receipt. Report line with no receipt → status `ขาดบิล`
(missing bill). The receipt's own date/time replaces the report date when a
receipt exists. `total_payment_due` from the *report* wins over the receipt's.

**Step 2 — match each receipt to a bank deposit.**
For each line that has a receipt, take all statement rows whose datetime is
within **±1 minute** of the receipt's datetime. (The code comment says 2 min;
the code does 1. Pick one deliberately — this tolerance is the single biggest
driver of match rate.)

- no candidates → `ตรวจสอบข้อมูล` (needs review)
- otherwise pick the best candidate in this strict order:
  1. **name match** — first candidate whose `detail` names the report's customer
  2. **exact amount match** — if several, the one nearest in time
  3. **nearest in time**
- then verify: statement amount == report amount → `ยอดตรง` (amounts agree),
  else `ตรวจสอบข้อมูล`.

Record the bill `id` back onto the chosen statement row — the workbook's
second sheet is the statement annotated with which bill each deposit paid.

**Name matching rule.** Pull the first name out of the statement detail with
titles `MR`, `MISS.`, `นาย`, `นาง`, `นางสาว`; strip the same titles off the
report's customer name; case-insensitive substring test. Thai names have no
reliable surname position in bank details, so first-name containment is the
rule. Keep it.

**Step 3 — force-match the off-statement payments.**
Cash (`เงินสด`) and pay-at-property via ZUZU (`zuzuจ่าย ณ ที่พัก`) never appear
in the bank statement. Match those by `(id, date)` only, copy the report amount
into the statement amount, and set the status to the payment method itself.

**Step 4 — split by payment channel.**
One numeric column per channel, filled with the statement amount, chosen by
first match on the receipt's `payment_info` text (and the report's `สถานะ`):

`ยกเลิกบิล` (cancelled — wins over everything) · `กรุงไทย` · `เงินสด` ·
`บัตรเครดิต` · `โอนขาด` · `โอนเกิน` · `คืนประกัน` · `ZUZUจ่าย ณ ที่พัก` ·
`เข้าระบบZUZU`

This is a first-match-wins chain on substrings of free LLM text. It is fragile
by nature; in a rebuild, make the LLM return an enum instead (see §7).

**Status vocabulary** (user-facing, keep the Thai strings — they are what the
accountant reads and types):
`ยอดตรง` matched · `ตรวจสอบข้อมูล` needs review · `ขาดบิล` no receipt ·
`ยกเลิกบิล` cancelled · `เงินสด` cash · `zuzuจ่าย ณ ที่พัก` paid at property.

Sort order: everything except `ขาดบิล` on top, missing receipts at the bottom.

---

## 4. The output workbook (the deliverable)

Not a dump — a working document. Whatever library you use must support all of:

**Sheet 1 `Matching Report`** — one row per report line, plus:
- a **data-validation dropdown** on the status cell with the six statuses
- **conditional formatting** per status (green matched, yellow review, red
  missing, orange cancelled, dark green manual) — must be conditional, not
  static fills, so it re-colors when the accountant changes the dropdown
- a live formula in the `ยกเลิกบิล` column: `=IF(status="ยกเลิกบิล", amount, 0)`
- a TOTAL row of `SUM` formulas over every numeric column
- a prefix subtotal table built from `SUMIFS` on `id` prefix, then
  grand total → minus cancelled → net
- a prefix × payment-channel matrix, also `SUMIFS`

**Sheet 2 `add-statement`** — the bank statement with a `bill_id` column
inserted as the second column, showing which bill each deposit was matched to.

Everything is written as **live Excel formulas, not computed values**. That is
deliberate: the accountant flips a status dropdown and every total updates
without re-running the app. If your new stack's spreadsheet library cannot
write formulas, data validation, and conditional formatting, pick another one.
(JS: ExcelJS. Java/Kotlin: Apache POI. .NET: ClosedXML. Go: excelize.)

---

## 5. Extraction (the LLM step)

- Currently Gemini `gemini-3.1-flash-lite`, temperature 0, one multimodal call
  per file or chunk, Thai prompt, JSON array out.
- **PDFs are chunked at 25 pages per call** — a scan of 200 receipts is one
  PDF, and one call for all of it both blows the output token limit and loses
  accuracy. Keep chunking in the rebuild; tune the number against your model's
  output limit, not its input limit.
- Images go as-is (JPEG/PNG).
- The hardest field by far is **`payment_info`**: it is read from *which
  checkbox is ticked* on the paper receipt, with a mark that may be an X, a
  slash or any scribble. The prompt branches: for `44 เรสซิเดนซ์` / `44 เฮ้า`
  the checkboxes are the two banks (ธ.กรุงไทย / ธ.กรุงศรี); for other companies
  they are the payment methods at the bottom-left. If the receipt layouts
  differ per company in your data too, keep this branch.
- Response parsing currently takes the substring from the first `[` to the last
  `]` and `json.loads` it. Replace this with the provider's structured-output /
  JSON-schema mode — it removes this whole class of failure.

Cost shape: one call per 25 receipt pages. Extraction is the only paid step and
the only slow one; everything after it is local computation.

---

## 6. Application behavior worth preserving

- **Per-company session history.** Receipts accumulate across uploads before a
  run, keyed by company, deduplicated by `id` (last wins). Accountants scan in
  batches over a day and reconcile once.
- **History export/restore.** Because the history lives in server session
  memory, it dies on restart; there is an explicit export-to-file and
  restore-from-file. In a rebuild, **put this in a real database instead** and
  the whole feature disappears. That is the single biggest simplification
  available.
- **Report and statement are re-uploaded every run**, receipts are not.
- Pre-flight checklist: the run button stays disabled until report + statement
  + at least one receipt (new or in history) are present.
- The output is a download, and the run is idempotent — rerunning with the same
  inputs produces the same workbook.

---

## 7. Fix these in the rebuild

Known problems in the current code — don't port them.

1. **Money as floats.** Amounts are parsed to float and compared with `==`.
   Use integer minor units (satang) or a decimal type, and compare with a
   tolerance you choose explicitly.
2. **A statement row can be matched to more than one bill.** Candidate
   selection never excludes already-matched deposits, so two receipts a few
   seconds apart can both claim the same deposit and both read `ยอดตรง`. Make
   assignment one-to-one (greedy by best score, or a proper assignment pass).
3. **Silent data loss on bad LLM output.** A truncated or unparseable response
   returns an empty list; those receipts then appear as `ขาดบิล` and the UI
   still says extraction succeeded. Surface per-file extraction failures to the
   user, and never let an extraction error masquerade as a missing bill.
4. **`KeyError` on missing keys.** The pipeline assumes every record has `id`,
   `date`, `time`. Validate records against a schema at the boundary, drop or
   quarantine bad ones with a visible message, and keep the rest.
5. **Misleading result counts.** "Bills processed" counts receipts, "matched"
   counts report rows; the ratio is nonsense. Count both over the same
   denominator — report lines.
6. **Hardcoded `2026` year prefixes** in the subtotal tables.
7. **Broad `except Exception`** around data loading turns a malformed file into
   a confusing empty-frame error much later. Fail at the boundary with the real
   cause.
8. **Receipt uploads are written to a `temp_uploads/` directory on disk** under
   their original filename before extraction. Keep them in memory, or at least
   use a per-request temp dir with a generated name.
9. The current UI remounts *all* uploaders after a successful run, so the
   report and statement must be re-uploaded before the next company.

---

## 8. Stack notes

What the Python libraries were doing, so you know what to look for:

| Current | Job | What you need from a replacement |
|---|---|---|
| pandas | joins, grouping, datetime parse | any dataframe lib, or plain SQL — the dataset is small (hundreds of rows), so a database join or hand-written loop is entirely reasonable |
| xlsxwriter | the workbook | formulas + data validation + conditional formatting (see §4) |
| pypdf | page-count and page-range splitting | same |
| google-genai | multimodal file → JSON | any provider with image/PDF input and structured output |
| streamlit | the whole UI, server, session state, file upload, download | a normal web app; the UI is four uploaders, a company selector and a download button |
| python-dotenv | `GOOGLE_API_KEY` | keep the key server-side; it must never reach the browser |

**Scale is small.** Hundreds of report lines and receipts per run, one user at a
time. Nothing here needs streaming, queues or distributed anything — but the
extraction step takes minutes for a large scan, so the new UI needs real
progress feedback and must not block on a single HTTP request.

**Non-negotiables:** UTF-8 Thai throughout (filenames, Excel cells, logs), the
Thai status strings exactly as written, day-first date parsing everywhere, and
the live-formula workbook.

---

## 9. What the rebuild changed

Decisions taken during the rebuild that override the notes above.

| Note says | The app does | Why |
|---|---|---|
| §3 step 1: join receipts on `(date, id)` | joins on `id` alone | a receipt whose printed date disagrees with the report still finds its line |
| §3 step 2: ±1 minute (code) / ±2 (comment) | **±2 minutes** | staff round the handwritten time; ±2 matched 20/20 on the May 2026 scan |
| §3: six statuses | five the engine sets (`ยอดตรง`, `ตรวจสอบข้อมูล`, `ขาดบิล`, `โอนเกิน`, `โอนขาด`) plus `ยกเลิกบิล` from §2a's `สถานะ` rule, which the accountant can also pick | 44 Residence has no cash or ZUZU receipts, so §3 step 3 and the channel split in §4 are not built yet |
| §4: `โอนขาด` / `โอนเกิน` are **payment-channel columns**, filled from the receipt's free-text `payment_info` | they are **statuses**, computed from the deposit against `รวมสุทธิ`, and only when the statement names the customer | the accountant wants to see who paid the wrong amount; the channel columns remain unbuilt, and must not be wired to these statuses |
| §3: sort `ขาดบิล` to the bottom | keeps the report's own row order | sheet 1 has to look like the file that was uploaded |
| §4: prefix × channel matrix | prefix subtotals only, lined up under `รวมสุทธิ`, plus a `รวม` row over every money column | the channel columns wait for the other companies |
| §5: `gemini-3.1-flash-lite` | `gemini-3.8-flash` | the lite model read a payment time of 14:42 as 14:12 and lost the deposit |
| §5: parse the first `[` to the last `]` | a JSON schema and an enum for the bank | removes the whole class of half-parsed answers |
| §6: session history with export/restore | nothing is stored between runs | as §6 itself recommends |

All eight problems in §7 are fixed: integer satang instead of floats, one
deposit to one bill, extraction failures surfaced instead of becoming `ขาดบิล`,
schema validation at every boundary, counts over one denominator, the year read
from the document numbers, errors raised at the file boundary with their real
cause, and uploads kept in memory rather than written to `temp_uploads/`.

Two things the notes did not foresee, found in the real data and now handled:
the bank statement's `ฝากเงินรวม` footer row (it would be read as a
1,025,370.00 deposit) and a misread document number arriving on two receipts
(both lines go to `ตรวจสอบข้อมูล` with a note instead of one silently
overwriting the other).
