import type { Dataset, ColumnSchema } from "../models/dataset.js";
import type { DatasetProfile, ColumnProfile, NumericStats, CategoricalStats } from "../models/profile.js";

export class ProfilingService {
  profile(dataset: Dataset): DatasetProfile {
    const { metadata, data } = dataset;
    const totalRows = data.length;
    
    // Sample
    const sampleSize = Math.min(5, totalRows);
    const sample = data.slice(0, sampleSize);

    // Duplicates
    let duplicateRows = 0;
    if (totalRows > 0) {
      const seen = new Set<string>();
      for (const row of data) {
        // Simple deterministic serialization for equality checking
        const hash = JSON.stringify(row, Object.keys(row).sort());
        if (seen.has(hash)) {
          duplicateRows++;
        } else {
          seen.add(hash);
        }
      }
    }

    const columnProfiles: Record<string, ColumnProfile> = {};
    const missingValues: Record<string, number> = {};

    for (const schema of metadata.schema) {
      const profile = this.profileColumn(schema, data);
      columnProfiles[schema.name] = profile;
      missingValues[schema.name] = profile.missingCount;
    }

    return {
      metadata,
      missingValues,
      duplicateRows,
      columnProfiles,
      sample,
    };
  }

  private profileColumn(schema: ColumnSchema, data: Record<string, unknown>[]): ColumnProfile {
    const name = schema.name;
    let missingCount = 0;
    const nonNullValues: unknown[] = [];

    for (const row of data) {
      const val = row[name];
      if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
        missingCount++;
      } else {
        nonNullValues.push(val);
      }
    }

    const totalRows = data.length;
    const missingPercentage = totalRows === 0 ? 0 : (missingCount / totalRows) * 100;

    // Frequencies & Unique count
    const frequencies: Record<string, number> = {};
    for (const val of nonNullValues) {
      const key = String(val);
      frequencies[key] = (frequencies[key] || 0) + 1;
    }
    const uniqueCount = Object.keys(frequencies).length;

    let numericStats: NumericStats | undefined = undefined;
    let categoricalStats: CategoricalStats | undefined = undefined;

    if (nonNullValues.length > 0) {
      if (schema.type === 'number') {
        const nums = nonNullValues
          .map(v => Number(v))
          .filter(n => !isNaN(n));
        
        if (nums.length > 0) {
          nums.sort((a, b) => a - b);
          
          let sum = 0;
          for (const n of nums) sum += n;
          const mean = sum / nums.length;
          
          const min = nums[0]!;
          const max = nums[nums.length - 1]!;
          
          const mid = Math.floor(nums.length / 2);
          const median = nums.length % 2 === 0 
            ? (nums[mid - 1]! + nums[mid]!) / 2 
            : nums[mid]!;
            
          let sumSqDiff = 0;
          for (const n of nums) {
            sumSqDiff += Math.pow(n - mean, 2);
          }
          const variance = nums.length > 1 ? sumSqDiff / (nums.length - 1) : 0;
          const stdDev = Math.sqrt(variance);

          numericStats = { min, max, mean, median, stdDev };
        }
      }

      if (schema.type === 'string' || schema.type === 'boolean' || schema.type === 'date') {
        const sortedFreq = Object.entries(frequencies).sort((a, b) => b[1] - a[1]);
        const topN = sortedFreq.slice(0, 10);
        const topValues = topN.map(e => e[0]);
        const topFrequencies = Object.fromEntries(topN);
        categoricalStats = { topValues, frequencies: topFrequencies };
      }
    }

    const result: ColumnProfile = {
      name,
      missingCount,
      missingPercentage,
      uniqueCount
    };
    
    if (numericStats) result.numericStats = numericStats;
    if (categoricalStats) result.categoricalStats = categoricalStats;
    
    return result;
  }
}
