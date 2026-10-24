import { GoogleGenAI } from "@google/genai";
import { extractionResponseSchema, geminiResponseSchema, type ExtractedReceipt } from "./schema.ts";

/**
 * gemini-3.1-flash-lite is cheaper but misreads handwritten digits: on the
 * May 2026 scan it read a payment time of 14:42 as 14:12, which puts the
 * deposit outside the 1-minute match window. 3.8-flash read all 20 correctly.
 * Override with GEMINI_MODEL.
 */
export const DEFAULT_MODEL = "gemini-3.8-flash";

export class ExtractionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ExtractionError";
    this.retryable = retryable;
  }
}

export interface VisionClient {
  readonly model: string;
  /** One call: a prompt plus one or more receipt images. */
  readReceipts(prompt: string, images: readonly Buffer[]): Promise<ExtractedReceipt[]>;
}

export interface GeminiOptions {
  /** Server-side only. It must never be sent to the browser. */
  readonly apiKey?: string;
  readonly model?: string;
  readonly maxAttempts?: number;
}

export function createGeminiClient(options: GeminiOptions = {}): VisionClient {
  const apiKey = options.apiKey ?? process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new ExtractionError("GOOGLE_API_KEY is not set - put it in .env at the repo root", false);
  }
  const model = options.model ?? process.env["GEMINI_MODEL"] ?? DEFAULT_MODEL;
  const maxAttempts = options.maxAttempts ?? 3;
  const ai = new GoogleGenAI({ apiKey });

  return {
    model,
    async readReceipts(prompt, images) {
      const parts = [
        { text: prompt },
        ...images.map((jpeg) => ({ inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } })),
      ];

      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts }],
            config: {
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: geminiResponseSchema as never,
            },
          });
          const text = response.text;
          if (text === undefined || text.trim() === "") {
            throw new ExtractionError("the model returned an empty response", true);
          }
          // Structured output means this is plain JSON - no substring hunting.
          const parsed = extractionResponseSchema.safeParse(JSON.parse(text));
          if (!parsed.success) {
            throw new ExtractionError(`the model's JSON did not fit the schema: ${parsed.error.message}`, true);
          }
          return parsed.data.receipts;
        } catch (cause) {
          lastError = cause;
          if (!isRetryable(cause) || attempt === maxAttempts) break;
          await sleep(500 * 2 ** (attempt - 1));
        }
      }
      throw asExtractionError(lastError);
    },
  };
}

function isRetryable(cause: unknown): boolean {
  if (cause instanceof ExtractionError) return cause.retryable;
  const text = String(cause);
  return /429|500|502|503|504|ECONNRESET|ETIMEDOUT|fetch failed|overloaded/i.test(text);
}

function asExtractionError(cause: unknown): ExtractionError {
  if (cause instanceof ExtractionError) return cause;
  return new ExtractionError(cause instanceof Error ? cause.message : String(cause), false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
