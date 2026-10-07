/**
 * Error types for dsh-data-analyst.
 *
 * Structured errors are required by PRD §AC-09:
 *   Unsupported format: .abc
 *   Supported formats: .csv, .tsv, .json, .jsonl, .xlsx, .xls
 */

export class DataAnalystError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DataAnalystError";
  }
}

export class UnsupportedFormatError extends DataAnalystError {
  constructor(extension: string, supportedFormats: string[]) {
    super(
      "UNSUPPORTED_FORMAT",
      `Unsupported file format: ${extension}\nSupported formats: ${supportedFormats.join(", ")}`,
      { extension, supportedFormats },
    );
    this.name = "UnsupportedFormatError";
  }
}

export class FileNotFoundError extends DataAnalystError {
  constructor(filePath: string) {
    super("FILE_NOT_FOUND", `File not found: ${filePath}`, { filePath });
    this.name = "FileNotFoundError";
  }
}

export class MalformedDataError extends DataAnalystError {
  constructor(filePath: string, reason: string, details?: unknown) {
    super(
      "MALFORMED_DATA",
      `Malformed data in file "${filePath}": ${reason}`,
      details,
    );
    this.name = "MalformedDataError";
  }
}

export class DatasetNotFoundError extends DataAnalystError {
  constructor(datasetId: string) {
    super(
      "DATASET_NOT_FOUND",
      `Dataset not found: ${datasetId}`,
      { datasetId },
    );
    this.name = "DatasetNotFoundError";
  }
}

export class AnalysisError extends DataAnalystError {
  constructor(reason: string, details?: unknown) {
    super("ANALYSIS_ERROR", `Analysis failed: ${reason}`, details);
    this.name = "AnalysisError";
  }
}

export class InvestigationNotFoundError extends DataAnalystError {
  constructor(investigationId: string) {
    super(
      "INVESTIGATION_NOT_FOUND",
      `Investigation not found: ${investigationId}`,
      { investigationId },
    );
    this.name = "InvestigationNotFoundError";
  }
}

export class HypothesisNotFoundError extends DataAnalystError {
  constructor(hypothesisId: string, investigationId: string) {
    super(
      "HYPOTHESIS_NOT_FOUND",
      `Hypothesis not found: ${hypothesisId} (investigation: ${investigationId})`,
      { hypothesisId, investigationId },
    );
    this.name = "HypothesisNotFoundError";
  }
}

export class EvidenceNotFoundError extends DataAnalystError {
  constructor(evidenceId: string) {
    super("EVIDENCE_NOT_FOUND", `Evidence not found: ${evidenceId}`, {
      evidenceId,
    });
    this.name = "EvidenceNotFoundError";
  }
}

export class FindingNotFoundError extends DataAnalystError {
  constructor(findingId: string) {
    super("FINDING_NOT_FOUND", `Finding not found: ${findingId}`, {
      findingId,
    });
    this.name = "FindingNotFoundError";
  }
}

/**
 * Raised when an investigation transition violates the PRD §19 state
 * machine, or when a mutation is attempted on a terminal investigation.
 */
export class InvestigationStateError extends DataAnalystError {
  constructor(
    investigationId: string,
    currentStatus: string,
    reason: string,
  ) {
    super(
      "INVESTIGATION_STATE_ERROR",
      `Investigation ${investigationId} is in state "${currentStatus}": ${reason}`,
      { investigationId, currentStatus, reason },
    );
    this.name = "InvestigationStateError";
  }
}
