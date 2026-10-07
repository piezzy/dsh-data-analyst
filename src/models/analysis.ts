export type AggregationFunction = 'count' | 'sum' | 'mean' | 'min' | 'max' | 'median';
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'is_null' | 'not_null';
export type SortDirection = 'asc' | 'desc';

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface SortCondition {
  column: string;
  direction: SortDirection;
}

export interface AnalysisRequest {
  datasetId: string;
  filters?: FilterCondition[];
}

export interface AggregateRequest extends AnalysisRequest {
  aggregations: Array<{
    column: string;
    func: AggregationFunction;
    alias?: string;
  }>;
  groupBy?: string;
  sort?: SortCondition;
}

export interface CompareRequest extends AnalysisRequest {
  groupColumn: string;
  baseGroup: string;
  compareGroup: string;
  valueColumn: string;
  func: AggregationFunction;
}

export interface TrendRequest extends AnalysisRequest {
  timeColumn: string;
  valueColumn: string;
  func: AggregationFunction;
}

export interface AnalysisMetadata {
  operation: string;
  datasetId: string;
  selectedColumns?: string[];
  filters?: FilterCondition[];
  grouping?: string;
  aggregations?: string[];
}

export interface AnalysisResult<T = unknown> {
  metadata: AnalysisMetadata;
  result: T;
}

export interface AnalysisEngine {
  aggregate(request: AggregateRequest): Promise<AnalysisResult<Record<string, unknown>[]>>;
  compare(request: CompareRequest): Promise<AnalysisResult<Record<string, unknown>>>;
  trend(request: TrendRequest): Promise<AnalysisResult<Record<string, unknown>[]>>;
}
