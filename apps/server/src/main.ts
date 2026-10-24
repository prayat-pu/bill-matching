import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { COMPANIES, LoadError } from "@bill/core";
import type { Company } from "@bill/core";
import { JobStore, type Job } from "./jobs.ts";

const PORT = Number(process.env["PORT"] ?? 5174);
/** 127.0.0.1 in development; a container has to listen on all interfaces. */
const HOST = process.env["HOST"] ?? "127.0.0.1";
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
/** Where `npm run build` puts the React app. Served only if it is there, so
 *  `npm run dev` still goes through Vite. */
const WEB_DIST = resolve(process.env["WEB_DIST"] ?? resolve(import.meta.dirname, "../../web/dist"));

const app = Fastify({ logger: { level: process.env["LOG_LEVEL"] ?? "info" } });
const jobs = new JobStore();

await app.register(multipart, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 12 },
});

app.get("/api/health", async () => ({ ok: true, companies: COMPANIES }));

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  // One page, no router - anything that is not an API route is the app.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "no such route" });
    return reply.sendFile("index.html");
  });
  app.log.info({ dist: WEB_DIST }, "serving the web app");
}

/**
 * Upload the three inputs and start a run. Files stay in memory; the API key
 * never leaves this process.
 */
app.post("/api/jobs", async (request, reply) => {
  let company: Company | null = null;
  let report: { name: string; data: Buffer } | null = null;
  let statement: { name: string; data: Buffer } | null = null;
  const receipts: { name: string; data: Buffer }[] = [];

  for await (const part of request.parts()) {
    if (part.type === "field") {
      if (part.fieldname === "company") company = asCompany(String(part.value));
      continue;
    }
    const data = await part.toBuffer();
    if (part.fieldname === "report") report = { name: part.filename, data };
    else if (part.fieldname === "statement") statement = { name: part.filename, data };
    else if (part.fieldname === "receipts") receipts.push({ name: part.filename, data });
  }

  const missing = [
    report === null ? "report" : null,
    statement === null ? "statement" : null,
    receipts.length === 0 ? "receipts" : null,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    return reply.code(400).send({ error: `missing files: ${missing.join(", ")}` });
  }
  if (company === null) {
    return reply.code(400).send({ error: `company must be one of: ${COMPANIES.join(", ")}` });
  }

  const job = jobs.start({
    company,
    reportFile: report!,
    statementFile: statement!,
    receiptFiles: receipts,
  });
  return reply.code(202).send({ jobId: job.id });
});

/** Live progress. Extraction takes minutes, so the UI watches this. */
app.get<{ Params: { id: string } }>("/api/jobs/:id/events", (request, reply) => {
  const job = jobs.get(request.params.id);
  if (job === undefined) return reply.code(404).send({ error: "no such job" });

  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const send = (current: Job) => {
    const payload = {
      ...current.progress,
      error: current.error,
      summary: current.progress.phase === "done" ? current.summary : null,
    };
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (current.progress.phase === "done" || current.progress.phase === "failed") {
      job.listeners.delete(send);
      reply.raw.end();
    }
  };

  job.listeners.add(send);
  send(job);

  // A comment every 15 s keeps proxies from closing a quiet stream and lets
  // the page tell "still working" apart from "the server died".
  const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
  const stop = () => {
    clearInterval(heartbeat);
    job.listeners.delete(send);
  };
  reply.raw.on("close", stop);
  const socket: NodeJS.EventEmitter = request.raw;
  socket.on("close", stop);
  return reply;
});

app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
  const job = jobs.get(request.params.id);
  if (job === undefined) return reply.code(404).send({ error: "no such job" });
  return reply.send({ ...job.progress, error: job.error, summary: job.summary });
});

app.get<{ Params: { id: string } }>("/api/jobs/:id/workbook", async (request, reply) => {
  const job = jobs.get(request.params.id);
  if (job === undefined) return reply.code(404).send({ error: "no such job" });
  if (job.workbook === null || job.summary === null) {
    return reply.code(409).send({ error: `the run is ${job.progress.phase}` });
  }
  const name = job.summary.workbookName;
  return reply
    .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .header("content-disposition", `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    .send(job.workbook);
});

app.setErrorHandler((error: unknown, _request, reply) => {
  // A malformed upload must say what is actually wrong with it.
  if (error instanceof LoadError) return reply.code(400).send({ error: error.message });
  app.log.error(error);
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(500).send({ error: message });
});

function asCompany(value: string): Company | null {
  return COMPANIES.find((name) => name === value) ?? null;
}

await app.listen({ port: PORT, host: HOST });
