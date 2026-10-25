# @bill/core

Parsing and the reconciliation engine. No I/O beyond reading an `.xlsx`
buffer, no network, no UI — everything here is a pure function over data, which
is why it is the only package with real test coverage of the business rules.

## What is in it

| File | Job |
|---|---|
| `money.ts` | amounts as **integer satang**, never floats |
| `dates.ts` | day-first (`DD/MM/YYYY`) parsing, Buddhist years, the statement's newline-split cell |
| `names.ts` | who paid, read out of the statement's free text |
| `domain.ts` | the Thai statuses and notes, document-number prefixes, the year |
| `load/report.ts` | the accounting report — header on row **5** |
| `load/statement.ts` | the bank statement — header on row **8** |
| `load/receipt.ts` | validates what the vision model returned |
| `match/reconcile.ts` | the engine |

## The rules

1. **Join** each receipt to a report line on the document number alone. A line
   with no receipt is `ขาดบิล`. A receipt whose id is in no line is reported,
   never dropped. Two receipts with one id means the model misread one, so both
   go to `ตรวจสอบข้อมูล` with a note.
2. **Time** comes from the receipt's handwritten slip, the **date** from the
   report, because staff write the month wrong often enough to matter.
3. **Deposit**: candidates are within **±2 minutes**; the best is picked by
   name → exact amount → nearest in time, and one deposit can only pay one
   bill (a greedy pass over all pairs, best first).
4. **Amount**: equal → `ยอดตรง`. Different *and the statement names this
   customer* → `โอนเกิน` / `โอนขาด` with the difference in the note. Different
   with no name link → `ตรวจสอบข้อมูล`; another guest's transfer can land
   seconds away, so no payment difference is claimed without evidence.
5. **Cancelled**: a report row whose `สถานะ` contains `ยกเลิก` becomes
   `ยกเลิกบิล` and takes no deposit.

## Things that will bite you

- **Money is satang.** `parseSatang("12,345.67") === 1234567`. Compare with
  `amountsAgree`, never `===` on baht. The real files carry 1,221 cells with
  satang and none deeper than two decimals, so the integer form is lossless.
- **Dates are day-first everywhere**, and built with `Date.UTC`, so no local
  timezone can shift them. `new Date(string)` would read `03/12/2026` as March.
- **Payer names** can be `SCB นาย สมชาย …`, `BBL NOPPAMAS NILON MISS` (title at
  the end) or `KTB MISS.SARANYA …` (title glued on). A QR PromptPay transfer
  names nobody. See the comment at the top of `names.ts`.
- **`RC2026*` does not match `RCD2026…`** with these document numbers, but
  `prefixOf` still checks `RCD` first. Do not reorder it.
- **The statement ends with `ฝากเงินรวม`**, a totals row. The loader stops
  there; without that it reads the 1,025,370.00 total as a deposit.
- The loaders **throw `LoadError` naming the missing Thai column** rather than
  returning an empty frame that fails confusingly later.

## Tests

```bash
npx vitest run --root packages/core
```

`test/raw-files.test.ts` runs against the real files in `raw/` and skips itself
when they are absent, so a fresh clone still passes.
