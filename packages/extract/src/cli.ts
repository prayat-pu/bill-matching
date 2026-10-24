import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { extractReceiptsFromPdf } from "./extract.ts";

interface Args {
  inputs: string[];
  company: string;
  outDir: string;
  pagesPerCall: number;
  concurrency: number;
  dpi: number;
  rotate: number;
}

const USAGE = `usage: npm run extract -- [files...] [options]

  files              PDFs to read. Default: every .pdf in ./raw
  --company NAME     company on the receipts (default "44 Residence")
  --out-dir DIR      where the JSON goes (default ./raw/extracted)
  --pages-per-call N images per model call (default 1 - best for handwriting)
  --concurrency N    calls in flight (default 4)
  --dpi N            rasterize resolution (default 150)
  --rotate DEG       clockwise rotation of each page (default 270)

  The API key is read from .env at the repo root: GEMINI_API_KEY or GOOGLE_API_KEY.`;

/** npm runs workspace scripts from the package dir; INIT_CWD is where the user
 *  actually typed the command, so relative paths mean what they expect. */
function fromUserCwd(path: string): string {
  return resolve(process.env["INIT_CWD"] ?? process.cwd(), path);
}

async function parseArgs(argv: readonly string[]): Promise<Args> {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    if (arg.startsWith("--")) flags.set(arg.slice(2), argv[++i] ?? "");
    else positional.push(arg);
  }

  const repoRoot = resolve(import.meta.dirname, "../../..");
  const inputs = positional.length > 0 ? positional.map(fromUserCwd) : await findPdfs(join(repoRoot, "raw"));
  if (inputs.length === 0) throw new Error(`no PDFs found in ${join(repoRoot, "raw")}\n\n${USAGE}`);

  return {
    inputs,
    company: flags.get("company") ?? "44 Residence",
    outDir: fromUserCwd(flags.get("out-dir") ?? join(repoRoot, "raw", "extracted")),
    pagesPerCall: Number(flags.get("pages-per-call") ?? 1),
    concurrency: Number(flags.get("concurrency") ?? 4),
    dpi: Number(flags.get("dpi") ?? 150),
    rotate: Number(flags.get("rotate") ?? 270),
  };
}

async function findPdfs(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("*.pdf", { cwd: dir })) found.push(resolve(dir, entry));
  return found.sort();
}

const args = await parseArgs(process.argv.slice(2));
await mkdir(args.outDir, { recursive: true });

let anyFailure = false;

for (const input of args.inputs) {
  const name = basename(input);
  const started = Date.now();
  process.stderr.write(`\n${name} - ${args.company}\n`);

  const result = await extractReceiptsFromPdf(await readFile(input), {
    company: args.company,
    pagesPerCall: args.pagesPerCall,
    concurrency: args.concurrency,
    render: { dpi: args.dpi, rotateDegrees: args.rotate },
    onProgress: (p) => {
      process.stderr.write(
        `\r  pages ${p.pagesDone}/${p.pagesTotal}  receipts ${p.receiptsFound}  failed calls ${p.failures}   `,
      );
    },
  });
  process.stderr.write("\n");

  const out = join(args.outDir, name.replace(/\.pdf$/i, "") + ".json");
  await writeFile(
    out,
    JSON.stringify(
      {
        source: name,
        company: args.company,
        model: result.model,
        pages: result.pagesTotal,
        extractedAt: new Date().toISOString(),
        receipts: result.raw,
        rejected: result.rejected,
        failures: result.failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(
    `  ${result.receipts.length} usable receipts, ${result.rejected.length} rejected, ` +
      `${result.failures.length} failed calls, ${seconds}s\n  wrote ${out}\n`,
  );

  const unsure = result.raw.filter((r) => r.bank_confidence === "unsure");
  if (unsure.length > 0) {
    process.stderr.write(`  check the bank checkbox by hand on: ${unsure.map((r) => r.id).join(", ")}\n`);
  }
  for (const failure of result.failures) {
    process.stderr.write(`  FAILED pages ${failure.pages.join(",")}: ${failure.reason}\n`);
  }
  for (const bad of result.rejected) {
    process.stderr.write(`  REJECTED record ${bad.row}: ${bad.reason}\n`);
  }
  if (result.failures.length > 0) anyFailure = true;
}

if (anyFailure) process.exitCode = 1;
