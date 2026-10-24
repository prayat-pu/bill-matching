import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export interface RenderedPage {
  readonly page: number;
  readonly jpeg: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface RenderOptions {
  /** Rasterize resolution. 150 dpi is enough to read the handwritten slip. */
  readonly dpi?: number;
  /** Clockwise rotation applied after rasterizing. The receipts are photographed
   *  sideways, so 270 (a quarter turn anticlockwise) puts them upright. */
  readonly rotateDegrees?: number;
  /** Longest edge of the image sent to the model. */
  readonly maxEdge?: number;
  readonly jpegQuality?: number;
}

const DEFAULTS = { dpi: 150, rotateDegrees: 270, maxEdge: 2000, jpegQuality: 85 } as const;

/**
 * Which pdftoppm to run. On Windows there is no package manager to put it on
 * PATH, so POPPLER_PATH can point straight at the bundled binary.
 */
function pdftoppmCommand(): string {
  const configured = process.env["PDFTOPPM"] ?? process.env["POPPLER_PATH"];
  return configured !== undefined && configured.trim() !== "" ? configured.trim() : "pdftoppm";
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

/**
 * Rasterize every page of a PDF to an upright JPEG.
 *
 * Requires `pdftoppm` (poppler-utils) on PATH. The PDF is written to a private
 * temp directory with a generated name and deleted afterwards - uploads never
 * land in the project tree under their own filename.
 */
export async function renderPdfPages(
  pdf: Buffer,
  options: RenderOptions = {},
): Promise<RenderedPage[]> {
  const opts = { ...DEFAULTS, ...options };
  const dir = await mkdtemp(join(tmpdir(), "bill-render-"));
  try {
    const pdfPath = join(dir, "input.pdf");
    await writeTemp(pdfPath, pdf);
    await runPdftoppm(["-jpeg", "-r", String(opts.dpi), pdfPath, join(dir, "page")]);

    const files = (await readdir(dir)).filter((f) => f.startsWith("page-") && f.endsWith(".jpg")).sort();
    if (files.length === 0) throw new RenderError("pdftoppm produced no pages - is the PDF readable?");

    const pages: RenderedPage[] = [];
    for (const [i, file] of files.entries()) {
      const raw = await readFile(join(dir, file));
      const pipeline = sharp(raw).rotate(opts.rotateDegrees).resize({
        width: opts.maxEdge,
        height: opts.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      });
      const { data, info } = await pipeline.jpeg({ quality: opts.jpegQuality }).toBuffer({ resolveWithObject: true });
      pages.push({ page: i + 1, jpeg: data, width: info.width, height: info.height });
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Rotate and normalize a photo that was uploaded as an image, not a PDF. */
export async function renderImage(image: Buffer, options: RenderOptions = {}): Promise<RenderedPage> {
  const opts = { ...DEFAULTS, ...options };
  const { data, info } = await sharp(image)
    .rotate(opts.rotateDegrees)
    .resize({ width: opts.maxEdge, height: opts.maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: opts.jpegQuality })
    .toBuffer({ resolveWithObject: true });
  return { page: 1, jpeg: data, width: info.width, height: info.height };
}

async function writeTemp(path: string, data: Buffer): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, data);
}

function runPdftoppm(args: readonly string[]): Promise<void> {
  const command = pdftoppmCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    // @fastify/multipart augments stream event types globally, so this needs
    // the plain EventEmitter view to keep "data" valid.
    const errorStream: NodeJS.EventEmitter = child.stderr;
    errorStream.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (cause) => {
      reject(
        new RenderError(
          `could not run "${command}" (${cause.message}). ` +
            "Install poppler (Linux: sudo apt install poppler-utils; " +
            "Windows: unzip poppler and set PDFTOPPM to its bin\\pdftoppm.exe).",
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new RenderError(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
