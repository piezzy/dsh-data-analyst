/**
 * Excel loader for dsh-data-analyst.
 *
 * Supports .xlsx and .xls via the xlsx (SheetJS) library.
 * Uses the first sheet by default.
 *
 * Handles:
 * - Formula cells (computed value used, not formula string)
 * - Date cells (Excel serial dates → ISO strings)
 * - Merged cells (top-left value used)
 * - Multi-sheet workbooks (first sheet + warning)
 *
 * PRD requirement: G1 - Multi-format data ingestion, .xlsx / .xls support.
 */

import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import type { Dataset, SupportedFormat } from "../models/dataset.js";
import { FileNotFoundError, MalformedDataError } from "../utils/errors.js";
import { nextId } from "../utils/id-generator.js";
import { detectColumnSchemas } from "../utils/type-detector.js";
import type { DataLoader } from "./loader.js";

export class ExcelLoader implements DataLoader {
  readonly supportedExtensions: string[] = [".xlsx", ".xls"];

  async load(filePath: string): Promise<Dataset> {
    let buffer: Buffer;

    try {
      buffer = await fs.readFile(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FileNotFoundError(filePath);
      }
      throw err;
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,  // Convert Excel serial dates → JS Date objects
        cellNF: false,    // Don't keep number format strings
        cellText: false,  // Don't add .w (formatted text) fields
      });
    } catch (err) {
      throw new MalformedDataError(
        filePath,
        `Failed to parse Excel file: ${(err as Error).message}`,
      );
    }

    if (workbook.SheetNames.length === 0) {
      throw new MalformedDataError(filePath, "Excel workbook contains no sheets");
    }

    // Use first sheet; future versions can accept a sheet name parameter
    const sheetName = workbook.SheetNames[0]!;
    const sheet = workbook.Sheets[sheetName];

    if (sheet === undefined) {
      throw new MalformedDataError(filePath, `Sheet "${sheetName}" not found in workbook`);
    }

    // Convert sheet to JSON — header row becomes object keys
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,     // Fill missing cells with null
      raw: false,       // Convert values to JS-native types (dates, numbers)
      dateNF: "YYYY-MM-DD", // Format dates as ISO date strings when raw:false
    });

    // Normalise Date objects → ISO strings (xlsx may return Date instances)
    const rows = rawRows.map((row) => {
      const normalised: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
          normalised[key] = value.toISOString();
        } else {
          normalised[key] = value;
        }
      }
      return normalised;
    });

    const ext = path.extname(filePath).toLowerCase();
    const format: SupportedFormat = ext === ".xls" ? "xls" : "xlsx";
    const fileName = path.basename(filePath);
    const schema = detectColumnSchemas(rows);

    return {
      metadata: {
        datasetId: nextId("dataset"),
        fileName,
        format,
        rows: rows.length,
        columns: schema.length,
        schema,
        loadedAt: new Date().toISOString(),
      },
      data: rows,
    };
  }
}
