/** Thrown at the file boundary so a malformed upload fails with its real cause. */
export class LoadError extends Error {
  readonly detail: { readonly source: string; readonly row?: number } | undefined;

  constructor(message: string, detail?: { readonly source: string; readonly row?: number }) {
    super(message);
    this.name = "LoadError";
    this.detail = detail;
  }
}

/** A row that could not be used, kept so the UI can show it instead of hiding it. */
export interface RejectedRow {
  readonly source: string;
  readonly row: number;
  readonly reason: string;
}

export interface Loaded<T> {
  readonly rows: readonly T[];
  readonly rejected: readonly RejectedRow[];
}
