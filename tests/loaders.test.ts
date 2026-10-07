import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CsvLoader } from '../src/formats/csv-loader.js';
import { TsvLoader } from '../src/formats/tsv-loader.js';
import { JsonLoader } from '../src/formats/json-loader.js';
import { ExcelLoader } from '../src/formats/excel-loader.js';
import { DatasetNotFoundError } from '../src/utils/errors.js';
import { resetCounters } from '../src/utils/id-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Data Loaders', () => {
  beforeEach(() => {
    resetCounters();
  });

  const runAssertions = (dataset: any, expectedFormat: string) => {
    expect(dataset.metadata.datasetId).toBe('dataset-001');
    expect(dataset.metadata.format).toBe(expectedFormat);
    expect(dataset.metadata.rows).toBe(6);
    expect(dataset.metadata.columns).toBe(6);
    
    // Check schema detection
    const schemaMap = Object.fromEntries(dataset.metadata.schema.map((s: any) => [s.name, s]));
    expect(schemaMap['date'].type).toBe('date');
    expect(schemaMap['product'].type).toBe('string');
    expect(schemaMap['revenue'].type).toBe('number');
    expect(schemaMap['revenue'].nullable).toBe(true);
    expect(schemaMap['quantity'].type).toBe('number');
    expect(schemaMap['quantity'].nullable).toBe(false);
    expect(schemaMap['is_active'].type).toBe('boolean');

    // Check data
    expect(dataset.data.length).toBe(6);
    const firstRow = dataset.data[0];
    expect(firstRow['product']).toBe('Widget A');
    expect(Number(firstRow['quantity'])).toBe(100);
  };

  it('CsvLoader should parse CSV files correctly', async () => {
    const loader = new CsvLoader();
    const filePath = path.join(fixturesDir, 'sample.csv');
    const dataset = await loader.load(filePath);
    runAssertions(dataset, 'csv');
  });

  it('TsvLoader should parse TSV files correctly', async () => {
    const loader = new TsvLoader();
    const filePath = path.join(fixturesDir, 'sample.tsv');
    const dataset = await loader.load(filePath);
    runAssertions(dataset, 'tsv');
  });

  it('JsonLoader should parse JSON files correctly', async () => {
    const loader = new JsonLoader();
    const filePath = path.join(fixturesDir, 'sample.json');
    const dataset = await loader.load(filePath);
    runAssertions(dataset, 'json');
  });

  it('JsonLoader should parse JSONL files correctly', async () => {
    const loader = new JsonLoader();
    const filePath = path.join(fixturesDir, 'sample.jsonl');
    const dataset = await loader.load(filePath);
    runAssertions(dataset, 'jsonl');
  });

  it('ExcelLoader should parse XLSX files correctly', async () => {
    const loader = new ExcelLoader();
    const filePath = path.join(fixturesDir, 'sample.xlsx');
    const dataset = await loader.load(filePath);
    runAssertions(dataset, 'xlsx');
  });
});
