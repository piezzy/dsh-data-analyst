import type { 
  AnalysisEngine, 
  AggregateRequest, 
  CompareRequest, 
  TrendRequest, 
  AnalysisResult,
  FilterCondition,
  SortCondition,
  AggregationFunction
} from '../models/analysis.js';
import type { DatasetService } from '../services/dataset-service.js';
import { AnalysisError } from '../utils/errors.js';

export class NativeAnalysisEngine implements AnalysisEngine {
  constructor(private readonly datasetService: DatasetService) {}

  async aggregate(request: AggregateRequest): Promise<AnalysisResult<Record<string, unknown>[]>> {
    const dataset = this.datasetService.getDataset(request.datasetId);
    let data = dataset.data;

    // Apply filters
    if (request.filters) {
      data = this.applyFilters(data, request.filters);
    }

    // Grouping
    let grouped: Record<string, Record<string, unknown>[]> = {};
    if (request.groupBy) {
      for (const row of data) {
        const key = String(row[request.groupBy] ?? 'null');
        if (!grouped[key]) grouped[key] = [];
        grouped[key]!.push(row);
      }
    } else {
      grouped['all'] = data;
    }

    // Aggregating
    const resultRows: Record<string, unknown>[] = [];
    for (const [groupKey, rows] of Object.entries(grouped)) {
      const resultRow: Record<string, unknown> = {};
      if (request.groupBy) {
        resultRow[request.groupBy] = groupKey === 'null' ? null : groupKey;
      }

      for (const agg of request.aggregations) {
        const outCol = agg.alias || `${agg.func}_${agg.column}`;
        resultRow[outCol] = this.calculateAggregation(rows, agg.column, agg.func);
      }
      resultRows.push(resultRow);
    }

    // Sorting
    if (request.sort) {
      this.applySort(resultRows, request.sort);
    }

    const metadata: any = {
      operation: 'aggregate',
      datasetId: request.datasetId,
      selectedColumns: request.aggregations.map(a => a.column),
      aggregations: request.aggregations.map(a => a.func)
    };
    if (request.filters) metadata.filters = request.filters;
    if (request.groupBy) metadata.grouping = request.groupBy;

    return {
      metadata,
      result: resultRows
    };
  }

  async compare(request: CompareRequest): Promise<AnalysisResult<Record<string, unknown>>> {
    const dataset = this.datasetService.getDataset(request.datasetId);
    let data = dataset.data;

    if (request.filters) {
      data = this.applyFilters(data, request.filters);
    }

    const baseRows = data.filter(row => String(row[request.groupColumn]) === request.baseGroup);
    const compareRows = data.filter(row => String(row[request.groupColumn]) === request.compareGroup);

    const baseValue = this.calculateAggregation(baseRows, request.valueColumn, request.func);
    const compareValue = this.calculateAggregation(compareRows, request.valueColumn, request.func);

    const absoluteDiff = (typeof compareValue === 'number' && typeof baseValue === 'number') 
      ? compareValue - baseValue 
      : null;
      
    const percentageDiff = (absoluteDiff !== null && baseValue !== 0 && typeof baseValue === 'number') 
      ? (absoluteDiff / Math.abs(baseValue)) * 100 
      : null;

    const metadata: any = {
      operation: 'compare',
      datasetId: request.datasetId,
      grouping: request.groupColumn,
      selectedColumns: [request.valueColumn],
      aggregations: [request.func]
    };
    if (request.filters) metadata.filters = request.filters;

    return {
      metadata,
      result: {
        baseGroup: request.baseGroup,
        baseValue,
        compareGroup: request.compareGroup,
        compareValue,
        absoluteDiff,
        percentageDiff
      }
    };
  }

  async trend(request: TrendRequest): Promise<AnalysisResult<Record<string, unknown>[]>> {
    const dataset = this.datasetService.getDataset(request.datasetId);
    let data = dataset.data;

    if (request.filters) {
      data = this.applyFilters(data, request.filters);
    }

    // Group by time column
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const row of data) {
      const key = String(row[request.timeColumn] ?? 'null');
      if (key === 'null') continue; // Skip null dates for trend
      if (!grouped[key]) grouped[key] = [];
      grouped[key]!.push(row);
    }

    // Aggregate each time period
    const periods = Object.keys(grouped).sort();
    const resultRows: Record<string, unknown>[] = [];
    
    let previousValue: number | null = null;

    for (const period of periods) {
      const rows = grouped[period]!;
      const value = this.calculateAggregation(rows, request.valueColumn, request.func);
      
      let absoluteDiff: number | null = null;
      let percentageDiff: number | null = null;

      if (typeof value === 'number' && previousValue !== null) {
        absoluteDiff = value - previousValue;
        if (previousValue !== 0) {
          percentageDiff = (absoluteDiff / Math.abs(previousValue)) * 100;
        }
      }

      resultRows.push({
        [request.timeColumn]: period,
        value,
        absoluteDiff,
        percentageDiff
      });

      if (typeof value === 'number') {
        previousValue = value;
      } else {
        previousValue = null;
      }
    }

    const metadata: any = {
      operation: 'trend',
      datasetId: request.datasetId,
      grouping: request.timeColumn,
      selectedColumns: [request.valueColumn],
      aggregations: [request.func]
    };
    if (request.filters) metadata.filters = request.filters;

    return {
      metadata,
      result: resultRows
    };
  }

  private applyFilters(data: Record<string, unknown>[], filters: FilterCondition[]): Record<string, unknown>[] {
    return data.filter(row => {
      for (const filter of filters) {
        const val = row[filter.column];
        switch (filter.operator) {
          case 'eq': if (val !== filter.value) return false; break;
          case 'neq': if (val === filter.value) return false; break;
          case 'gt': if (val == null || val <= (filter.value as any)) return false; break;
          case 'lt': if (val == null || val >= (filter.value as any)) return false; break;
          case 'gte': if (val == null || val < (filter.value as any)) return false; break;
          case 'lte': if (val == null || val > (filter.value as any)) return false; break;
          case 'is_null': if (val !== null && val !== undefined && val !== '') return false; break;
          case 'not_null': if (val === null || val === undefined || val === '') return false; break;
          default: throw new AnalysisError(`Unknown filter operator: ${filter.operator}`);
        }
      }
      return true;
    });
  }

  private applySort(data: Record<string, unknown>[], sort: SortCondition): void {
    data.sort((a, b) => {
      const valA = a[sort.column];
      const valB = b[sort.column];
      
      if (valA === valB) return 0;
      if (valA == null) return sort.direction === 'asc' ? -1 : 1;
      if (valB == null) return sort.direction === 'asc' ? 1 : -1;

      const compare = valA < valB ? -1 : 1;
      return sort.direction === 'asc' ? compare : -compare;
    });
  }

  private calculateAggregation(rows: Record<string, unknown>[], column: string, func: AggregationFunction): number | null {
    if (rows.length === 0) return null;

    if (func === 'count') {
      let c = 0;
      for (const row of rows) {
        const val = row[column];
        if (val !== null && val !== undefined && val !== '') c++;
      }
      return c;
    }

    const numericValues = rows
      .map(r => r[column])
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(v => Number(v))
      .filter(n => !isNaN(n));

    if (numericValues.length === 0) return null;

    if (func === 'sum') {
      return numericValues.reduce((a, b) => a + b, 0);
    }
    if (func === 'mean') {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      return sum / numericValues.length;
    }
    if (func === 'min') {
      return Math.min(...numericValues);
    }
    if (func === 'max') {
      return Math.max(...numericValues);
    }
    if (func === 'median') {
      numericValues.sort((a, b) => a - b);
      const mid = Math.floor(numericValues.length / 2);
      return numericValues.length % 2 === 0
        ? (numericValues[mid - 1]! + numericValues[mid]!) / 2
        : numericValues[mid]!;
    }

    throw new AnalysisError(`Unknown aggregation function: ${func}`);
  }
}
