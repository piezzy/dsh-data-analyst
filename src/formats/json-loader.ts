/**
 * JSON and JSONL loader for dsh-data-analyst.
 *
 * Supported shapes:
 *   - JSON: Array<object>  →  each element is a row
 *   - JSON: { key: Array<object> }  →  uses the first array-valued key
 *   - JSONL: One JSON object per line, empty lines skipped
 *
 * Nested objects are stored as-is with type "unknown" in v0.1.
 * Flattening to dot-notation is a v0.2 enhancement.
 *
 * PRD requirement: G1 - Multi-format data ingestion, .json / .jsonl support.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Dataset, SupportedFormat } from "../models/dataset.js";
import { FileNotFoundError, MalformedDataError } from "../utils/errors.js";
import { nextId } from "../utils/id-generator.js";
import { detectColumnSchemas } from "../utils/type-detector.js";
import type { DataLoader } from "./loader.js";

function extractRows(
  parsed: unknown,
  filePath: string,
): Record<string, unknown>[] {
  // Case 1: top-level array
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];

    // Validate elements are objects
    const nonObjects = parsed.filter(
      (item) => typeof item !== "object" || item === null || Array.isArray(item),
    );
    if (nonObjects.length > 0) {
      throw new MalformedDataError(
        filePath,
        "JSON array elements must be objects (non-array, non-null)",
        { invalidCount: nonObjects.length },
      );
    }

    return parsed as Record<string, unknown>[];
  }

  // Case 2: object with a single array-valued key
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const arrayKeys = Object.keys(record).filter((k) =>
      Array.isArray(record[k]),
    );

    if (arrayKeys.length === 1) {
      return extractRows(record[arrayKeys[0]!], filePath);
    }

    if (arrayKeys.length > 1) {
      throw new MalformedDataError(
        filePath,
        `JSON object has multiple array-valued keys: ${arrayKeys.join(", ")}. ` +
          "Wrap the data in a top-level array instead.",
        { arrayKeys },
      );
    }
  }

  throw new MalformedDataError(
    filePath,
    "JSON file must contain an array of objects or an object with a single array-valued key",
    { received: typeof parsed },
  );
}

export class JsonLoader implements DataLoader {
  readonly supportedExtensions: string[] = [".json", ".jsonl"];

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

    const ext = path.extname(filePath).toLowerCase();
    const format: SupportedFormat = ext === ".jsonl" ? "jsonl" : "json";
    const fileName = path.basename(filePath);

    let rows: Record<string, unknown>[];

    if (format === "jsonl") {
      rows = this.parseJsonl(content, filePath);
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new MalformedDataError(
          filePath,
          `Invalid JSON: ${(err as Error).message}`,
        );
      }
      rows = extractRows(parsed, filePath);
    }

    // Normalise rows: union all keys, fill missing with null
    const allKeys = Array.from(
      new Set(rows.flatMap((r) => Object.keys(r))),
    );
    const normalisedRows = rows.map((row) => {
      const normalised: Record<string, unknown> = {};
      for (const key of allKeys) {
        normalised[key] = Object.prototype.hasOwnProperty.call(row, key)
          ? row[key]
          : null;
      }
      return normalised;
    });

    const schema = detectColumnSchemas(normalisedRows);

    return {
      metadata: {
        datasetId: nextId("dataset"),
        fileName,
        format,
        rows: normalisedRows.length,
        columns: schema.length,
        schema,
        loadedAt: new Date().toISOString(),
      },
      data: normalisedRows,
    };
  }

  private parseJsonl(
    content: string,
    filePath: string,
  ): Record<string, unknown>[] {
    const lines = content.split("\n");
    const rows: Record<string, unknown>[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line === "") continue; // Skip empty lines

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new MalformedDataError(
          filePath,
          `Invalid JSON on line ${i + 1}: ${(err as Error).message}`,
          { line: i + 1 },
        );
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new MalformedDataError(
          filePath,
          `JSONL line ${i + 1} must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
          { line: i + 1 },
        );
      }

      rows.push(parsed as Record<string, unknown>);
    }

    return rows;
  }
}
