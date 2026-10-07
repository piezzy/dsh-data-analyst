import type { DatasetMetadata } from "./dataset.js";

export type NumericStats = {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
};

export type CategoricalStats = {
  topValues: string[];
  frequencies: Record<string, number>;
};

export type ColumnProfile = {
  name: string;
  missingCount: number;
  missingPercentage: number;
  uniqueCount: number;
  numericStats?: NumericStats;
  categoricalStats?: CategoricalStats;
};

export type DatasetProfile = {
  metadata: DatasetMetadata;
  missingValues: Record<string, number>;
  duplicateRows: number;
  columnProfiles: Record<string, ColumnProfile>;
  sample: Record<string, unknown>[];
};
