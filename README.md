# Bill Reconciliation Center

Upload scanned receipts, the accounting report and the bank statement; get back
one Excel workbook that says which bill was paid, which needs a look, and which
has no receipt at all.

Rebuilt from the Python/Streamlit tool described in `REBUILD_NOTES.md`.

## What it does

1. Reads every page of the receipt PDFs with Gemini (handwritten payment time,
   printed document number, amount, which bank checkbox is ticked).
2. Joins each receipt to the accounting report on the document number
   (`เลขที่เอกสาร`) and adds the handwritten time to the line.
3. Finds the matching bank deposit: within **±2 minutes** of that time, same
   amount, and - where the statement names a payer - the same person. One
   deposit can only pay one bill.
4. Writes the workbook:
   - **`Matching Report`** - the accounting report as uploaded, with `time`,
     `match_bill_status` and `note` inserted as columns B, C and D. The status
     is a dropdown - `ยอดตรง` green, `ตรวจสอบข้อมูล` yellow, `ขาดบิล` red,
     `โอนเกิน` blue, `โอนขาด` purple, `ยกเลิกบิล` orange - colored by rule, so
     it recolors when you re-pick.
     Straight under the data, a `รวม` row `=SUM`s every money column (the
     meter-reading columns are left alone). Then one blank row, then a summary
     block lined up under `รวมสุทธิ`: one `SUMIF` per charge type on the
     document-number prefix, then `ยอดรวม` → `ยกเลิกบิล` → `ยอดสุทธิ`. The year
     in each pattern (`RA2026*`) is read from the document numbers in the
     sheet, and a report straddling a year end totals both years.
   - **`add-statement`** - the bank statement as uploaded, with `bill_id` as
     column B. A `bill_id` whose line is still `ตรวจสอบข้อมูล` is highlighted
     yellow, by rule, so clearing the status on sheet 1 clears the highlight.

### The statuses

| Status | Set when |
|---|---|
| `ยอดตรง` | a deposit inside the window matches `รวมสุทธิ` exactly |
| `โอนเกิน` | the statement **names this customer** and they sent more |
| `โอนขาด` | the statement **names this customer** and they sent less |
| `ตรวจสอบข้อมูล` | no deposit in the window, or one was found but nothing except the clock ties it to this bill |
| `ขาดบิล` | the report line has no receipt |
| `ยกเลิกบิล` | the report's own `สถานะ` column contains `ยกเลิก` — or the accountant picks it |

Over- and under-payment are only claimed when the payer is named. A deposit
found by time alone could be another guest's, so the app reports what it found
and leaves the judgement to a person.

A cancelled bill never takes a deposit, and its `รวมสุทธิ` is still counted in
the summary's charge-type row and in `ยอดรวม`; it leaves once, through the
`ยกเลิกบิล` line, which `ยอดสุทธิ` subtracts.

Notes written into the `note` column:

| Note | Means |
|---|---|
| `ยอดเงินในบิลกับยอดเงินสุทธิไม่สอดคล้องกัน` | the receipt's own total disagrees with `รวมสุทธิ` |
| `ยอดเงินตรงแต่ชื่อผู้โอนไม่ตรง` | right amount, but the transfer is in another name (often a company) |
| `มีใบเสร็จมากกว่าหนึ่งใบใช้เลขที่นี้ …` | two receipts claimed one document number |
| `โอนเกิน 51.00 บาท (รับ 800.00 / ควรได้ 749.00)` | how far over the named payer was |
| `โอนขาด 49.00 บาท (รับ 700.00 / ควรได้ 749.00)` | how far under |
| `พบเงินเข้า 800.00 บาท เวลา 09:25 ใกล้เคียงกัน แต่ยอดและชื่อไม่ตรง` | a deposit was near in time only — no difference is claimed |
| `ยกเลิกตามสถานะในรายงานบัญชี` | the engine cancelled it from the report, not a person |

Money is held as integer satang throughout, so the `.25` and `.75` amounts are
exact; baht appear only when a number is printed.

## Requirements

- Node 24+
- `pdftoppm` — `sudo apt install poppler-utils`
- A Gemini API key in `.env` at the repo root (see `.env.example`):

```
GEMINI_API_KEY=...
# GEMINI_MODEL=gemini-3.8-flash
```

The key is read by the server only. It never reaches the browser.

## Run

```bash
npm install
npm run dev          # API on :5174, web on :5173
```

Open http://localhost:5173, pick the company, drop in the three files, press
เริ่มกระทบยอด, then watch the steps: upload → read the Excel files → turn the
PDF into images → read the receipts with AI → match → build the workbook. The
AI step is the long one, roughly 5 s a page, and the page shows the page
counter, elapsed time and an estimate. Then download the workbook.

## Deploy with Docker

One image: Fastify serves both the API and the built React page, so there is
nothing else to run.

For the people who use the app day to day, there are three scripts in
[`deploy/docker/`](deploy/docker/README.md) — they check Docker is running,
ask for the API key if `.env` is missing, wait until the app really answers,
and print the addresses to open:

| | Windows | Linux |
|---|---|---|
| Start | double-click `start.cmd` | `./deploy/docker/start.sh` |
| Stop | double-click `stop.cmd` | `./deploy/docker/stop.sh` |
| Logs | double-click `logs.cmd` | `./deploy/docker/logs.sh` |

By hand it is:

```bash
docker compose up -d --build     # http://localhost:40000
docker compose logs -f
docker compose down
```

`docker-compose.yml` reads `.env` from the repo root, so `GEMINI_API_KEY` must
be there. The key stays inside the container.

The container runs read-only with a tmpfs on `/tmp` - the only thing written is
the private temp directory used while a PDF page is rasterized, and it is
deleted as soon as the model has read the page. Nothing else is persisted, so
the container can be killed and replaced at any time; a run in flight is lost
and has to be started again.

To change the port, set `PORT` in `docker-compose.yml` and map it:

```yaml
    environment:
      PORT: 8080
    ports:
      - "8080:8080"
```

Without compose:

```bash
docker build -t bill-matching .
docker run --rm -p 5174:5174 --env-file .env -e HOST=0.0.0.0 bill-matching
```

## Deploy on Windows

Windows 7 cannot host this - Node 24 needs Windows 10 or newer. Run it on one
Windows 10/11 PC and let the other machines (Windows 7 included) open it in a
browser. Step-by-step, with the `.cmd` files: [`deploy/windows/README.md`](deploy/windows/README.md).

The page is built for Chrome 109 / Firefox 115 ESR, the last versions that run
on Windows 7.

## Other commands

```bash
npm test             # core, workbook and extract suites
npm run typecheck
npm run extract      # read every PDF in ./raw into raw/extracted/*.json
npm run dry-run -- <report.xlsx> <statement.xlsx> <extracted.json>
npm run build        # production build of the web app
```

`dry-run` is the fastest way to check the matching rules without the UI or a
second trip to the model.

### About `raw/`

`raw/` is where the real files live: the accounting report, the bank statement
and the scanned receipts. It is **git-ignored** — it holds customers' names,
the company's account number and hundreds of real transfers, and none of that
belongs on a server. A fresh clone therefore has no `raw/`, and the tests that
read it (`packages/core/test/raw-files.test.ts`,
`packages/workbook/test/build.test.ts`, `packages/extract/test/phases.test.ts`)
skip themselves. Put your own files in `raw/` and they run.

## Layout

| Path | What |
|---|---|
| `packages/core` | parsing, name matching, the reconciliation engine |
| `packages/extract` | PDF → upright JPEG → Gemini → receipt records |
| `packages/workbook` | the two-sheet ExcelJS output |
| `apps/server` | Fastify API: upload, progress (SSE), download |
| `apps/web` | React + Vite single page |
| `deploy/docker` | start / stop / logs scripts for a host that has Docker |
| `deploy/windows` | installer and start scripts for a Windows host without Docker |
| `raw/` | your own report / statement / receipts — git-ignored |
| `scripts/` | `dev.ts`, `dry-run.ts` |

Nothing is stored between runs. Uploads live in memory, the workbook lives in
the job for 30 minutes, and the rendered page images are deleted as soon as the
model has read them.

## Known weak spots

- **Which bank checkbox is ticked.** Two Gemini models disagreed on 4 of 20
  receipts in the sample. Nothing in the workbook depends on it today, so the
  UI no longer reports it; `marked_box` and `bank_confidence` are still in the
  extraction JSON for whoever builds the payment-channel columns.
- **Thai vs Latin names.** `เตชิต` on the report and `DECHIT` on the transfer
  are the same person, but the name rule cannot see that, so the line passes
  with the name-mismatch note. Same for spelling variants (`อนุพงษ์` /
  `อนุพงศ์`).
- **Handwritten times.** They are what the whole deposit match hangs on. A
  misread digit moves the line to `ตรวจสอบข้อมูล`, never to a wrong deposit.
- **Page rotation is fixed, not detected.** Pages are turned 270° because that
  is how these scans come off the phone. A batch photographed the other way up
  reads badly; pass `--rotate 0|90|180` to `npm run extract`, or say so and the
  renderer can be taught to retry the other angles when a page comes back
  unreadable.
- **A misread document number** shows up as two receipts claiming one bill.
  That is caught: both lines go to `ตรวจสอบข้อมูล` with a note, and the UI
  lists the duplicate.
