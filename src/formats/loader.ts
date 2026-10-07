/**
 * DataLoader interface and LoaderRegistry for dsh-data-analyst.
 *
 * PRD requirement (§8):
 *   "Format handling harus menggunakan adapter pattern."
 *   "Analysis engine tidak boleh bergantung langsung terhadap file format."
 *
 * New formats (Parquet, SQLite in v0.2/v0.3) simply register a new
 * DataLoader implementation — no changes to anything else.
 */

import path from "node:path";
import type { Dataset } from "../models/dataset.js";
import { UnsupportedFormatError } from "../utils/errors.js";

/**
 * Contract that every format-specific loader must implement.
 */
export interface DataLoader {
  /** File extensions this loader handles, including the leading dot (e.g., ".csv") */
  readonly supportedExtensions: string[];

  /**
   * Load a file and return a fully-populated Dataset.
   * Throws FileNotFoundError, MalformedDataError, or DataAnalystError.
   */
  load(filePath: string): Promise<Dataset>;
}

/**
 * Registry that maps file extensions to DataLoader implementations.
 * The analysis engine calls `getLoader(path)` — it never touches
 * format-specific logic directly.
 */
export class LoaderRegistry {
  private readonly loaders: Map<string, DataLoader> = new Map();

  /**
   * Register a DataLoader. If two loaders claim the same extension,
   * the last one registered wins.
   */
  register(loader: DataLoader): void {
    for (const ext of loader.supportedExtensions) {
      this.loaders.set(ext.toLowerCase(), loader);
    }
  }

  /**
   * Return the loader for a given file path.
   * @throws UnsupportedFormatError if no loader is registered for the extension.
   */
  getLoader(filePath: string): DataLoader {
    const ext = path.extname(filePath).toLowerCase();
    const loader = this.loaders.get(ext);

    if (loader === undefined) {
      throw new UnsupportedFormatError(ext || "(no extension)", this.getSupportedFormats());
    }

    return loader;
  }

  /** Return all registered file extensions, sorted. */
  getSupportedFormats(): string[] {
    return Array.from(this.loaders.keys()).sort();
  }
}
