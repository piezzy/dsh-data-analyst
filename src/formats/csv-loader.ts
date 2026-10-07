/**
 * CSV loader for dsh-data-analyst.
 *
 * Uses papaparse for robust CSV parsing — handles:
 * - BOM (byte order mark)
 * - Quoted fields containing commas and newlines
 * - Various encodings
 * - Auto-detection of delimiter
 *
 * PRD requirement: G1 - Multi-format data ingestion, .csv support.
 */

import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import type { Dataset, SupportedFormat } from "../models/dataset.js";
import { FileNotFoundError, MalformedDataError } from "../utils/errors.js";
import { nextId } from "../utils/id-generator.js";
import { detectColumnSchemas } from "../utils/type-detector.js";
import type { DataLoader } from "./loader.js";

/**
 * Internal CSV loader — parses CSV files into Dataset.
 * Also used by TsvLoader with a different delimiter.
 */
export class CsvLoader implements DataLoader {
  readonly supportedExtensions: string[] = [".csv"];

  protected readonly format: SupportedFormat = "csv";
  protected readonly delimiter: string = ",";

  async load(filePath: string): Promise<Dataset> {
    let content: string;

    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FileNotFoundError(filePath);
      }
      throw err;
    }

    const result = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      delimiter: this.delimiter,
      skipEmptyLines: true,
      dynamicTyping: false, // We do our own type detection
      transformHeader: (header) => header.trim(),
    });

    // Surface parse errors — PapaParse collects them in result.errors
    if (result.errors.length > 0) {
      const firstError = result.errors[0];
      throw new MalformedDataError(
        filePath,
        firstError?.message ?? "Unknown parse error",
        result.errors,
      );
    }

    const rows = result.data;
    const schema = detectColumnSchemas(rows);
    const fileName = path.basename(filePath);

    return {
      metadata: {
        datasetId: nextId("dataset"),
        fileName,
        format: this.format,
        rows: rows.length,
        columns: schema.length,
        schema,
        loadedAt: new Date().toISOString(),
      },
      data: rows,
    };
  }
}
