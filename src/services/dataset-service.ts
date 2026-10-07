/**
 * DatasetService for dsh-data-analyst.
 *
 * In-memory store for loaded datasets, keyed by datasetId.
 * Provides a single place for dataset lifecycle management,
 * so all tools (inspect_dataset, start_investigation, etc.)
 * reference the same loaded data without reloading.
 *
 * PRD requirement:
 * - G1: load datasets
 * - G2: return schema from loaded dataset
 * - AC-08: Dataset state must be serializable (metadata is plain JSON)
 */

import type { Dataset, DatasetMetadata } from "../models/dataset.js";
import { DatasetNotFoundError } from "../utils/errors.js";
import type { LoaderRegistry } from "../formats/loader.js";

export class DatasetService {
  private readonly datasets: Map<string, Dataset> = new Map();

  constructor(private readonly loaderRegistry: LoaderRegistry) {}

  /**
   * Load a dataset from a file path.
   * Dispatches to the correct loader via the registry.
   * The loaded dataset is stored and accessible by its datasetId.
   *
   * @throws UnsupportedFormatError if the file extension is not supported
   * @throws FileNotFoundError if the file does not exist
   * @throws MalformedDataError if the file content is invalid
   */
  async loadDataset(filePath: string): Promise<Dataset> {
    const loader = this.loaderRegistry.getLoader(filePath);
    const dataset = await loader.load(filePath);
    this.datasets.set(dataset.metadata.datasetId, dataset);
    return dataset;
  }

  /**
   * Retrieve a previously loaded dataset by its ID.
   * @throws DatasetNotFoundError if no dataset with this ID exists
   */
  getDataset(datasetId: string): Dataset {
    const dataset = this.datasets.get(datasetId);
    if (dataset === undefined) {
      throw new DatasetNotFoundError(datasetId);
    }
    return dataset;
  }

  /**
   * Check whether a dataset ID is currently loaded.
   */
  hasDataset(datasetId: string): boolean {
    return this.datasets.has(datasetId);
  }

  /**
   * Return metadata for all currently loaded datasets.
   * Useful for listing available datasets without loading full data.
   */
  listDatasets(): DatasetMetadata[] {
    return Array.from(this.datasets.values()).map((d) => d.metadata);
  }

  /**
   * Remove a dataset from the store.
   * Returns true if the dataset existed, false otherwise.
   */
  unloadDataset(datasetId: string): boolean {
    return this.datasets.delete(datasetId);
  }
}
