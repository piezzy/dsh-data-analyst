import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LoaderRegistry } from '../src/formats/loader.js';
import { CsvLoader } from '../src/formats/csv-loader.js';
import { DatasetService } from '../src/services/dataset-service.js';
import { DatasetNotFoundError, UnsupportedFormatError } from '../src/utils/errors.js';
import { resetCounters } from '../src/utils/id-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('DatasetService', () => {
  let datasetService: DatasetService;

  beforeEach(() => {
    resetCounters();
    const registry = new LoaderRegistry();
    registry.register(new CsvLoader());
    datasetService = new DatasetService(registry);
  });

  it('should load and store a dataset successfully', async () => {
    const filePath = path.join(fixturesDir, 'sample.csv');
    const dataset = await datasetService.loadDataset(filePath);
    
    expect(dataset.metadata.datasetId).toBe('dataset-001');
    expect(datasetService.hasDataset('dataset-001')).toBe(true);
    
    const retrieved = datasetService.getDataset('dataset-001');
    expect(retrieved).toBe(dataset);
  });

  it('should throw UnsupportedFormatError for unknown extensions', async () => {
    const filePath = path.join(fixturesDir, 'unknown.txt');
    await expect(datasetService.loadDataset(filePath)).rejects.toThrow(UnsupportedFormatError);
  });

  it('should throw DatasetNotFoundError when getting a non-existent dataset', () => {
    expect(() => datasetService.getDataset('unknown-id')).toThrow(DatasetNotFoundError);
  });

  it('should list all loaded datasets metadata', async () => {
    const filePath = path.join(fixturesDir, 'sample.csv');
    await datasetService.loadDataset(filePath);
    
    const list = datasetService.listDatasets();
    expect(list.length).toBe(1);
    expect(list[0]!.datasetId).toBe('dataset-001');
  });

  it('should unload a dataset', async () => {
    const filePath = path.join(fixturesDir, 'sample.csv');
    await datasetService.loadDataset(filePath);
    
    expect(datasetService.hasDataset('dataset-001')).toBe(true);
    
    const unloaded = datasetService.unloadDataset('dataset-001');
    expect(unloaded).toBe(true);
    expect(datasetService.hasDataset('dataset-001')).toBe(false);
  });
});
