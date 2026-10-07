/**
 * Core Dataset model for dsh-data-analyst.
 *
 * All data loaders produce a Dataset. All downstream services
 * (profiling, investigation, analysis engine) consume a Dataset.
 *
 * Row-oriented format is used for v0.1 because it is:
 * - Universal across all supported formats
 * - JSON-serializable (supports reproducibility requirement)
 * - Convertible to columnar when Polars/DuckDB are added in M3
 */

export type ColumnType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "unknown";

export type SupportedFormat =
  | "csv"
  | "tsv"
  | "json"
  | "jsonl"
  | "xlsx"
  | "xls";

/**
 * Schema information for a single column.
 */
export type ColumnSchema = {
  /** Column name as found in the source file */
  name: string;
  /** Inferred data type */
  type: ColumnType;
  /** True if any cell in this column was null/empty/undefined */
  nullable: boolean;
};

/**
 * Lightweight metadata about a loaded dataset.
 * Returned directly from inspect_dataset (M1).
 * Extended by profiling-service in M2.
 */
export type DatasetMetadata = {
  datasetId: string;
  fileName: string;
  format: SupportedFormat;
  rows: number;
  columns: number;
  schema: ColumnSchema[];
  loadedAt: string; // ISO 8601
};

/**
 * A fully loaded dataset — metadata plus row-oriented data.
 * The data array holds one Record per row, keyed by column name.
 */
export type Dataset = {
  metadata: DatasetMetadata;
  /** Row-oriented data: each element is a row, keyed by column name */
  data: Record<string, unknown>[];
};
