/**
 * TSV (Tab-Separated Values) loader for dsh-data-analyst.
 *
 * Trivial extension of CsvLoader — identical logic, different delimiter.
 *
 * PRD requirement: G1 - Multi-format data ingestion, .tsv support.
 */

import type { SupportedFormat } from "../models/dataset.js";
import { CsvLoader } from "./csv-loader.js";

export class TsvLoader extends CsvLoader {
  override readonly supportedExtensions: string[] = [".tsv"];
  protected override readonly format: SupportedFormat = "tsv";
  protected override readonly delimiter: string = "\t";
}
