import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CsvLoader } from '../src/formats/csv-loader.js';
import { JsonLoader } from '../src/formats/json-loader.js';
import { ProfilingService } from '../src/services/profiling-service.js';
import { resetCounters } from '../src/utils/id-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('ProfilingService', () => {
  let profilingService: ProfilingService;

  beforeEach(() => {
    resetCounters();
    profilingService = new ProfilingService();
  });

  it('should profile a normal dataset correctly (CSV)', async () => {
    const loader = new CsvLoader();
    const filePath = path.join(fixturesDir, 'sample.csv');
    const dataset = await loader.load(filePath);
    
    const profile = profilingService.profile(dataset);
    
    expect(profile.metadata.datasetId).toBe('dataset-001');
    expect(profile.duplicateRows).toBe(0);
    expect(profile.sample.length).toBeLessThanOrEqual(5);
    
    // Check missing value detection (revenue has 1 missing value)
    expect(profile.missingValues['revenue']).toBe(1);
    expect(profile.missingValues['product']).toBe(0);

    // Check specific column profile for 'revenue'
    const revProfile = profile.columnProfiles['revenue']!;
    expect(revProfile.missingCount).toBe(1);
    expect(revProfile.missingPercentage).toBeCloseTo((1 / 6) * 100);
    expect(revProfile.uniqueCount).toBe(5); // 5 non-null values
    
    expect(revProfile.numericStats).toBeDefined();
    expect(revProfile.numericStats!.min).toBe(85000);
    expect(revProfile.numericStats!.max).toBe(230000.75);
    // 85000 + 145000 + 150000.5 + 160000 + 220000 + 230000.75 = ... wait, missing value
    // 5 non-null: 150000.5, 85000, 230000.75, 145000, 220000
    // mean: (150000.5 + 85000 + 230000.75 + 145000 + 220000) / 5 = 166000.25
    expect(revProfile.numericStats!.mean).toBeCloseTo(166000.25);
    expect(revProfile.numericStats!.median).toBe(150000.5);

    // Check categorical stats for 'region'
    const regProfile = profile.columnProfiles['region']!;
    expect(regProfile.categoricalStats).toBeDefined();
    expect(regProfile.categoricalStats!.topValues).toContain('Jakarta');
    expect(regProfile.categoricalStats!.frequencies['Jakarta']).toBe(2);
    expect(regProfile.categoricalStats!.frequencies['Surabaya']).toBe(2);
    expect(regProfile.categoricalStats!.frequencies['Bandung']).toBe(2);
  });

  it('should handle duplicate rows correctly (JSON)', async () => {
    // Generate a quick dataset with duplicates
    const dataset = {
      metadata: {
        datasetId: 'dataset-002',
        fileName: 'dupes.json',
        format: 'json' as const,
        rows: 5,
        columns: 1,
        schema: [{ name: 'val', type: 'string' as const, nullable: false }],
        loadedAt: new Date().toISOString()
      },
      data: [
        { val: 'A' },
        { val: 'A' }, // dupe
        { val: 'B' },
        { val: 'C' },
        { val: 'C' }  // dupe
      ]
    };
    
    const profile = profilingService.profile(dataset);
    expect(profile.duplicateRows).toBe(2);
  });

  it('should handle empty datasets gracefully', () => {
    const dataset = {
      metadata: {
        datasetId: 'dataset-003',
        fileName: 'empty.csv',
        format: 'csv' as const,
        rows: 0,
        columns: 1,
        schema: [{ name: 'val', type: 'string' as const, nullable: true }],
        loadedAt: new Date().toISOString()
      },
      data: []
    };
    
    const profile = profilingService.profile(dataset);
    expect(profile.duplicateRows).toBe(0);
    expect(profile.sample.length).toBe(0);
    expect(profile.missingValues['val']).toBe(0);
    expect(profile.columnProfiles['val']!.missingPercentage).toBe(0);
    expect(profile.columnProfiles['val']!.numericStats).toBeUndefined();
    expect(profile.columnProfiles['val']!.categoricalStats).toBeUndefined();
  });
});
