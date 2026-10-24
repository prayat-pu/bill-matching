# @bill/extract

Reads the scanned receipts and turns them into receipt records.

```
pdf -> pdftoppm (150 dpi) -> rotate upright -> JPEG -> Gemini -> JSON
```

## Run it

```bash
npm run extract                                  # every .pdf in ./raw
npm run extract -- raw/one.pdf --company "44 Room"
npm run extract -- --pages-per-call 2 --concurrency 8
npm run extract -- --help
```

Output goes to `raw/extracted/<name>.json`.

## Needs

- `pdftoppm` (`sudo apt install poppler-utils`)
- `GEMINI_API_KEY` in `.env` at the repo root

## Choices worth knowing

- **One page per call.** The receipts are photos with a handwritten slip;
  accuracy drops when several share a call. `--pages-per-call` raises it.
- **Rotation 270.** The scans are photographed sideways, and the angle is
  **fixed, not detected** — a batch shot the other way up needs
  `--rotate 0|90|180`. A few degrees of tilt is fine; a quarter turn is not.
- **Structured output.** The model answers against a JSON schema, so there is
  no substring hunting and no half-parsed response.
- **The printed date wins.** Staff write the payment date by hand and get the
  month wrong; the handwritten value is kept as `slip_date` for the audit
  trail, but `date` is the printed one, which is what joins to the report.
- **The handwritten time is the match key.** It is the single field the whole
  reconciliation depends on, so the model reports
  `bank_confidence` and the CLI prints every unsure receipt.

## Output

One record per receipt: `id`, `date` (printed), `slip_date` (handwritten, kept
for the audit trail), `time`, `room`, `total_payment_due`, `marked_box`,
`bank`, `bank_confidence`, `customer_name`, `company`, `page`.

The reconciliation engine calls the payment field `payment_info`, because for
44 Room and 44 Home it is cash or ZUZU rather than a bank; `extract.ts` maps
`bank` onto it at the boundary.

## Known weak spots

- **Which bank checkbox is ticked.** On the May 2026 scan,
  `gemini-3.1-flash-lite` and `gemini-3.8-flash` disagreed on 4 of 20 receipts.
  Every unsure one is listed in the UI — have a human check it.
- **The default model is `gemini-3.8-flash`**, not the cheaper
  `gemini-3.1-flash-lite`: the lite model read a payment time of 14:42 as
  14:12, which puts the deposit outside the match window. Override with
  `GEMINI_MODEL`.
