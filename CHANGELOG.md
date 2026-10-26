# Changelog

Newest first. Dates are when the work landed.

## 2026-10-25

### The workbook

- **`วันที่` is a datetime now** (`2026-05-01 09:24:00`), carrying the
  receipt's handwritten time. The separate `time` column is gone, so the
  inserted columns are `match_bill_status` and `note` at B and C.
- **Summary block** under the data, lined up beneath `รวมสุทธิ`: one `SUMIF`
  per charge type on the document-number prefix, then
  `ยอดรวม` → `ยกเลิกบิล` → `ยอดสุทธิ`. The year comes from the document
  numbers in the sheet, and a report that straddles a year end totals both.
- **`รวม` row** straight under the data, `=SUM` over every money column. The
  meter-reading columns are left alone — they are counters, not money.
- The three added columns moved to **B, C, D**, in front of `เลขที่เอกสาร`.
- The report's **merged heading cells** are reproduced instead of repeating the
  label across every column they spanned.
- Columns that carry a total are widened, so Excel stops showing `###`.

### The rules

- **`โอนเกิน` / `โอนขาด`** added, but only when the statement names the
  customer. A deposit found by time alone keeps `ตรวจสอบข้อมูล` and a note
  saying what was found — another guest's transfer can land seconds away, and
  the app does not claim a payment difference it cannot prove.
- **`ยกเลิกบิล` is automatic again**, from the report's own `สถานะ` column
  (`REBUILD_NOTES.md` §2a), and still pickable by hand. A cancelled bill takes
  no deposit; its amount is still counted in the summary and removed once.
- **Duplicate document numbers** are caught: when the model misreads an id and
  two receipts claim one bill, both go to `ตรวจสอบข้อมูล` with a note instead
  of one silently overwriting the other.
- The payer-name rule handles `น.ส.`, titles glued to the name
  (`MISS.SARANYA`) and titles written after it (`NOPPAMAS NILON MISS`).

### Running it

- **Self-contained install** (`deploy/portable`): a Python script unpacks a
  checksum-verified portable Node and poppler into the project folder, writes
  `.env`, installs and builds — no administrator rights, nothing added to
  `PATH`, and **no reboot**, which the MSI-based Windows installer can
  otherwise demand. Deleting the folder uninstalls everything.
- **Docker scripts** for people who do not use a terminal: `start`, `stop` and
  `logs` for Windows and Linux. They check Docker is running, ask for the API
  key if `.env` is missing, wait until the app really answers, and print the
  addresses — real network cards only, not Docker's own bridges.
- **Windows installer** (`deploy/windows/install.cmd`) that downloads Node and
  poppler, writes `.env`, builds, and opens the firewall.
- **Progress** rewritten: upload percentage, a step list with a spinner, an
  indeterminate bar until the page count is known, elapsed time, an estimate,
  and a warning when a run goes quiet for 90 seconds.
- The review panel lists the bills that are `ตรวจสอบข้อมูล`. It used to list
  receipts where the model was unsure which bank checkbox was ticked, which
  nothing in the workbook reads.
- The page works on tablets: 44px hit areas on touch, `safari15` in the build
  target, and the `.xlsx` pickers offer the media type so iOS does not grey the
  files out.

### Extraction

- Default model is **`gemini-3.8-flash`**. `gemini-3.1-flash-lite` read a
  payment time of 14:42 as 14:12, which puts the deposit outside the window.
- `date` is the **printed** document date; the handwritten one is kept as
  `slip_date` for the audit trail. Staff get the month wrong — three of twenty
  slips in the sample say month 4 on a May receipt.
- The model answers against a **JSON schema** with an enum for the bank, so
  there is no substring hunting and no half-parsed response.
- `payment_info` renamed to `bank` in the extraction output; the engine still
  calls it `payment_info`, because for other companies it is cash or ZUZU.
- `PDFTOPPM` can point straight at the binary, so Windows needs no `PATH` edit.

## 2026-10-24 — the rebuild

Replaced the Python/pandas/Streamlit tool described in `REBUILD_NOTES.md` with
TypeScript: `@bill/core`, `@bill/extract`, `@bill/workbook`, a Fastify API and
a React page, in a Docker image.

All eight problems in `REBUILD_NOTES.md` §7 are fixed: integer satang instead
of floats, one deposit to one bill, extraction failures surfaced instead of
becoming `ขาดบิล`, schema validation at every boundary, counts over one
denominator, the year derived from the data, errors raised at the file
boundary with their real cause, and uploads kept in memory.

Two things the notes did not foresee, found in the real data: the statement's
`ฝากเงินรวม` footer row, which would otherwise be read as a 1,025,370.00
deposit, and misread document numbers.

`REBUILD_NOTES.md` §9 lists every deliberate departure from the original spec.
