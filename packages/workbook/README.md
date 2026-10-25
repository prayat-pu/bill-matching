# @bill/workbook

Turns a `ReconcileResult` into the file the accountant works in. ExcelJS.

```ts
const xlsx = await buildWorkbook({ result, report, statement, company });
```

`report` and `statement` are the `SheetSnapshot`s the loaders hand back — the
uploaded sheets kept verbatim, so the output looks like the file that went in.

## Sheet 1 — `Matching Report`

The accounting report, unchanged, with three columns inserted at **B, C, D**:

| | |
|---|---|
| `time` | the handwritten payment time, `HH:mm` |
| `match_bill_status` | a dropdown of the six statuses |
| `note` | why, joined with ` / ` |

Then, below the data:

- a **`รวม` row** of `=SUM` over every money column. The label sits in the
  `เลขมิเตอร์ไฟฟ้าล่าสุด` column, because everything to its left is a meter
  reading, not money, and summing those would be nonsense;
- one blank row;
- the **summary block**, lined up under `รวมสุทธิ`: one `SUMIF` per charge type
  on the document-number prefix, then `ยอดรวม` → `ยกเลิกบิล` → `ยอดสุทธิ`.

## Sheet 2 — `add-statement`

The bank statement, unchanged, with `bill_id` inserted as column **B**. A
`bill_id` whose bill is still `ตรวจสอบข้อมูล` is highlighted yellow.

## Everything is a live formula

This is the point of the file, not decoration. The accountant changes a
dropdown and the workbook re-does its own arithmetic:

- the status colors are **conditional formatting**, not painted fills, so a
  re-picked status recolors itself;
- `ยกเลิกบิล` is a `SUMIF` over the status column, so marking a bill cancelled
  moves `ยอดสุทธิ` immediately;
- sheet 2's highlight is an **expression** rule that reads the status off sheet
  1 with `COUNTIFS`, so fixing the status there clears the highlight here.

If you ever replace ExcelJS, the replacement must write formulas, data
validation **and** conditional formatting, or the file stops being a tool and
becomes a printout.

## Things that will bite you

- **The year in `RA2026*` comes from the data** (`result.years`), never a
  literal. A report that straddles a year end gets one `SUMIF` per year, added.
- **A cancelled bill is still counted** in its charge-type row and in
  `ยอดรวม`; it leaves once, through the `ยกเลิกบิล` line. Do not filter
  cancelled rows out of a sum — the money would disappear twice.
- **Set a width on any column you write a total into.** Excel shows `###` when
  a number does not fit, and the report's own columns arrive at the ~8
  character default. `widen()` only ever grows a column.
- **Merged heading cells** (`I4:N4`, `O4:W4` in the real export) are carried
  over and shifted by the inserted columns; without that the merged label is
  repeated across every cell it spanned.
- Rows below the header are **re-emitted one per report line**, so their row
  numbers do not match the uploaded sheet. Only merges in the heading block
  survive.

## Tests

```bash
npx vitest run --root packages/workbook
```

They build from the real files in `raw/` and reopen the result. ExcelJS does
not calculate, so formulas are checked as strings here; the numbers themselves
are verified by converting with LibreOffice (see the root README).
