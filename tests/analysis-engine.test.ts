import { describe, it, expect, beforeEach } from 'vitest';
import { NativeAnalysisEngine } from '../src/engines/native-engine.js';
import { DatasetService } from '../src/services/dataset-service.js';
import { LoaderRegistry } from '../src/formats/loader.js';
import { AnalysisError } from '../src/utils/errors.js';
import type { Dataset } from '../src/models/dataset.js';

describe('NativeAnalysisEngine', () => {
  let engine: NativeAnalysisEngine;
  let mockDatasetService: DatasetService;
  
  beforeEach(() => {
    mockDatasetService = {
      getDataset: (id: string) => {
        if (id === 'test-dataset') {
          return {
            metadata: { datasetId: 'test-dataset' },
            data: [
              { date: '2024-01-01', region: 'North', sales: 100, is_active: true },
              { date: '2024-01-01', region: 'South', sales: 200, is_active: true },
              { date: '2024-01-02', region: 'North', sales: 150, is_active: false },
              { date: '2024-01-02', region: 'South', sales: 250, is_active: true },
              { date: '2024-01-03', region: 'North', sales: null, is_active: true },
              { date: '2024-01-04', region: 'South', sales: 300, is_active: true },
            ]
          } as unknown as Dataset;
        } else if (id === 'empty-dataset') {
          return {
            metadata: { datasetId: 'empty-dataset' },
            data: []
          } as unknown as Dataset;
        }
        throw new Error('Dataset not found');
      }
    } as unknown as DatasetService;

    engine = new NativeAnalysisEngine(mockDatasetService);
  });

  it('should compute basic aggregations correctly (sum, mean, max, min, median, count)', async () => {
    const res = await engine.aggregate({
      datasetId: 'test-dataset',
      aggregations: [
        { column: 'sales', func: 'sum', alias: 'total_sales' },
        { column: 'sales', func: 'mean', alias: 'avg_sales' },
        { column: 'sales', func: 'max', alias: 'max_sales' },
        { column: 'sales', func: 'min', alias: 'min_sales' },
        { column: 'sales', func: 'median', alias: 'med_sales' },
        { column: 'sales', func: 'count', alias: 'count_sales' },
      ]
    });
    
    expect(res.result.length).toBe(1);
    const row = res.result[0]!;
    expect(row['total_sales']).toBe(1000); // 100+200+150+250+300
    expect(row['avg_sales']).toBe(200); // 1000 / 5
    expect(row['max_sales']).toBe(300);
    expect(row['min_sales']).toBe(100);
    expect(row['med_sales']).toBe(200); // 100, 150, 200, 250, 300 -> 200
    expect(row['count_sales']).toBe(5);
  });

  it('should support group-by aggregation and sorting', async () => {
    const res = await engine.aggregate({
      datasetId: 'test-dataset',
      groupBy: 'region',
      aggregations: [{ column: 'sales', func: 'sum', alias: 'total' }],
      sort: { column: 'total', direction: 'desc' }
    });

    expect(res.result.length).toBe(2);
    // South sum: 200+250+300 = 750
    // North sum: 100+150 = 250
    expect(res.result[0]!['region']).toBe('South');
    expect(res.result[0]!['total']).toBe(750);
    expect(res.result[1]!['region']).toBe('North');
    expect(res.result[1]!['total']).toBe(250);
  });

  it('should support filtering', async () => {
    const res = await engine.aggregate({
      datasetId: 'test-dataset',
      filters: [{ column: 'is_active', operator: 'eq', value: true }],
      aggregations: [{ column: 'sales', func: 'sum', alias: 'total' }]
    });

    // North 150 is false, North null is true
    // Sales active = 100 + 200 + 250 + 300 = 850
    expect(res.result[0]!['total']).toBe(850);
  });

  it('should support various filter operators (gt, lt, is_null)', async () => {
    const res = await engine.aggregate({
      datasetId: 'test-dataset',
      filters: [
        { column: 'sales', operator: 'gt', value: 150 }
      ],
      aggregations: [{ column: 'sales', func: 'count', alias: 'c' }]
    });
    // > 150 -> 200, 250, 300 = 3 items
    expect(res.result[0]!['c']).toBe(3);

    const resNull = await engine.aggregate({
      datasetId: 'test-dataset',
      filters: [{ column: 'sales', operator: 'is_null' }],
      aggregations: [{ column: 'region', func: 'count', alias: 'c' }]
    });
    expect(resNull.result[0]!['c']).toBe(1);
  });

  it('should throw AnalysisError on invalid filter operator', async () => {
    await expect(engine.aggregate({
      datasetId: 'test-dataset',
      filters: [{ column: 'sales', operator: 'invalid_op' as any, value: 0 }],
      aggregations: []
    })).rejects.toThrow(AnalysisError);
  });

  it('should support absolute and percentage comparisons', async () => {
    const res = await engine.compare({
      datasetId: 'test-dataset',
      groupColumn: 'region',
      baseGroup: 'North',
      compareGroup: 'South',
      valueColumn: 'sales',
      func: 'sum'
    });

    // Base (North) = 250
    // Compare (South) = 750
    // Absolute diff = 750 - 250 = 500
    // Percentage = (500 / 250) * 100 = 200%
    expect(res.result.baseValue).toBe(250);
    expect(res.result.compareValue).toBe(750);
    expect(res.result.absoluteDiff).toBe(500);
    expect(res.result.percentageDiff).toBe(200);
  });

  it('should calculate period-over-period trend', async () => {
    const res = await engine.trend({
      datasetId: 'test-dataset',
      timeColumn: 'date',
      valueColumn: 'sales',
      func: 'sum'
    });

    expect(res.result.length).toBe(4); // 01, 02, 03, 04

    // 01: 300
    expect(res.result[0]!['value']).toBe(300);
    expect(res.result[0]!['absoluteDiff']).toBeNull();

    // 02: 400
    expect(res.result[1]!['value']).toBe(400);
    expect(res.result[1]!['absoluteDiff']).toBe(100);
    expect(res.result[1]!['percentageDiff']).toBeCloseTo(33.33);

    // 03: null (no sales value for North on 03, and it's the only one) -> actually sum over empty numeric is null
    expect(res.result[2]!['value']).toBeNull();
    
    // 04: 300
    expect(res.result[3]!['value']).toBe(300);
    expect(res.result[3]!['absoluteDiff']).toBeNull(); // previous was null
  });

  it('should handle empty datasets gracefully', async () => {
    const res = await engine.aggregate({
      datasetId: 'empty-dataset',
      aggregations: [{ column: 'sales', func: 'sum', alias: 'total' }]
    });

    expect(res.result.length).toBe(1);
    expect(res.result[0]!['total']).toBeNull();
  });

  it('should handle invalid aggregation functions gracefully or throw', async () => {
    await expect(engine.aggregate({
      datasetId: 'test-dataset',
      aggregations: [{ column: 'sales', func: 'fake_agg' as any, alias: 'total' }]
    })).rejects.toThrow(AnalysisError);
  });
});
