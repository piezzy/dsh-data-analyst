/**
 * Column type detector for dsh-data-analyst.
 *
 * Infers column types by sampling values from raw data rows.
 * Uses a majority-vote strategy with an 80% threshold to decide
 * the column type, falling back to "string" when ambiguous.
 *
 * PRD requirement: schema detection as part of dataset understanding (G2).
 */

import type { ColumnSchema, ColumnType } from "../models/dataset.js";

/** Maximum number of rows sampled per column during detection */
const SAMPLE_SIZE = 100;

/** Minimum ratio of typed values to declare a column of that type */
const TYPE_MAJORITY_THRESHOLD = 0.8;

/** ISO 8601 date-like patterns (date, datetime, time) */
const DATE_PATTERNS = [
  // ISO 8601 full datetime
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  // ISO 8601 date only
  /^\d{4}-\d{2}-\d{2}$/,
  // Common date formats
  /^\d{2}\/\d{2}\/\d{4}$/,
  /^\d{2}-\d{2}-\d{4}$/,
  /^\d{4}\/\d{2}\/\d{2}$/,
];

const BOOLEAN_VALUES = new Set([
  "true", "false", "yes", "no", "1", "0", "t", "f", "y", "n",
]);

function isNull(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function isNumber(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return !isNaN(parseFloat(trimmed)) && isFinite(Number(trimmed));
}

function isBoolean(value: string): boolean {
  return BOOLEAN_VALUES.has(value.trim().toLowerCase());
}

function isDate(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return DATE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function detectType(rawValue: unknown): ColumnType | null {
  if (isNull(rawValue)) return null;

  const value = String(rawValue);

  if (isDate(value)) return "date";
  if (isBoolean(value)) return "boolean";
  if (isNumber(value)) return "number";
  return "string";
}

/**
 * Infer the type of a single column from its sampled values.
 *
 * @param values - Array of raw cell values for the column
 * @returns Detected ColumnType
 */
function inferColumnType(values: unknown[]): ColumnType {
  const sample = values.slice(0, SAMPLE_SIZE);
  const nonNull = sample.filter((v) => !isNull(v));

  if (nonNull.length === 0) return "unknown";

  const typeCounts: Record<string, number> = {
    date: 0,
    boolean: 0,
    number: 0,
    string: 0,
  };

  for (const value of nonNull) {
    const detected = detectType(value);
    if (detected !== null) {
      typeCounts[detected] = (typeCounts[detected] ?? 0) + 1;
    }
  }

  const total = nonNull.length;

  // Use priority order: date > boolean > number > string
  // A column qualifies as a type if >= 80% of non-null values match
  for (const type of ["date", "boolean", "number"] as ColumnType[]) {
    if ((typeCounts[type] ?? 0) / total >= TYPE_MAJORITY_THRESHOLD) {
      return type;
    }
  }

  return "string";
}

/**
 * Detect column schemas from an array of row objects.
 *
 * @param rows - Row-oriented data (each row is Record<string, unknown>)
 * @returns Array of ColumnSchema, one per column
 */
export function detectColumnSchemas(
  rows: Record<string, unknown>[],
): ColumnSchema[] {
  if (rows.length === 0) return [];

  // Collect all column names across all rows (union)
  const columnNames = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  );

  return columnNames.map((name) => {
    const values = rows.map((row) => row[name]);
    const nullable = values.some((v) => isNull(v));
    const type = inferColumnType(values);

    return { name, type, nullable };
  });
}
