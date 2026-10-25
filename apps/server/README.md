# @bill/server

Fastify. Upload three files, watch the progress, download one workbook.
Stateless: nothing is written to disk and nothing survives a restart.

```bash
npm run dev -w @bill/server     # :5174, with --watch
```

## Routes

| | |
|---|---|
| `POST /api/jobs` | multipart: `receipts` (pdf, repeatable), `report`, `statement`, `company`. Returns `{ jobId }` at once. |
| `GET /api/jobs/:id/events` | SSE: phase, pages done, receipts found, failed calls, and the summary at the end |
| `GET /api/jobs/:id` | the same state, for a client that cannot hold a stream open |
| `GET /api/jobs/:id/workbook` | the `.xlsx` |
| `GET /api/health` | `{ ok: true, companies }` |

## How a run goes

`loading` → `rendering` → `extracting` → `matching` → `building` → `done`.

`rendering` matters: turning a 20-page scan into images takes about a minute
and reports nothing, so without its own phase the bar sits at zero and looks
broken. The page count is published as soon as rasterizing ends, before the
first model call returns.

## Things that will bite you

- **The API key never leaves this process.** It is read from `.env` at the repo
  root. Do not add a route that echoes the environment.
- **Uploads stay in memory** (80 MB cap, 12 files). The PDF only touches disk
  inside the private temp directory `render.ts` creates and deletes.
- **Jobs expire after 30 minutes** and live in a `Map`. Restarting loses a run
  in flight, including extraction you have already paid for.
- **Extraction failures are warnings, never `ขาดบิล`.** A page the model could
  not read must never look like a bill with no receipt.
- **`HOST` defaults to `127.0.0.1`.** A container has to set `0.0.0.0`, which
  the Dockerfile does.
- The SSE stream sends a comment every 15 s, so a proxy cannot quietly drop a
  quiet connection.
- `@fastify/multipart` augments Node's stream types globally; that is why a
  couple of places take the plain `NodeJS.EventEmitter` view of a stream.
