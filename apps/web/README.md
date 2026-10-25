# @bill/web

One page, React + Vite. No router, no state library.

```bash
npm run dev -w @bill/web        # :5173, proxies /api to :5174
npm run build -w @bill/web      # dist/, which the server serves in production
```

## What it shows

Three upload cards, a company picker, and a run button that stays disabled
until all three files are there. Then the run, which takes minutes, so the
whole screen is about making that wait legible:

- the upload's own percentage (via `XMLHttpRequest` — `fetch` cannot report
  upload progress, and a scan is tens of megabytes);
- a step list with a spinner on the live step: read the Excel files → turn the
  PDF into images → read the receipts → match → build;
- an indeterminate sliding bar until the page count is known, a real
  percentage after;
- elapsed time, ticking once a second, and an estimate from the pages done so
  far;
- a warning after 90 seconds of silence, because a stalled run and a slow run
  look identical otherwise.

Then the counts, the list of bills that need a human, and the download.

## Things that will bite you

- **`api.ts` is hand-kept in step with `apps/server/src/jobs.ts`.** There is no
  codegen. Change a shape on one side and change it on the other.
- **Build target is `chrome109, firefox115, safari15`.** Windows 7 tops out at
  Chrome 109 and the accountants use it, so nothing newer may be assumed —
  that is why there is no `color-mix()` in the CSS.
- **Touch**: dragging files is mouse-only; the button is the path on a tablet.
  Hit areas are 44px under `@media (pointer: coarse)`, and the `.xlsx` pickers
  send the media type as well as the extension or iOS greys the files out.
- Thai strings are rendered exactly as the server sends them. Do not
  "normalize" a status or a note in the UI; the workbook and the screen have
  to agree.
