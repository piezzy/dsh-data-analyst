/**
 * EvidenceService for dsh-data-analyst.
 *
 * Records and retrieves evidence (PRD §15). Evidence is the reproducible
 * output of deterministic computations — profiling (M2), aggregations,
 * comparisons, and trends (M3). Every finding must reference at least
 * one evidence record (PRD §16 invariant, AC-04).
 *
 * Evidence is linked to investigations by ID (PRD §18 evidence graph).
 * Recording evidence for a terminal investigation is rejected so that
 * completed/failed investigations remain immutable and reproducible.
 */

import type { Evidence, EvidenceType } from "../models/evidence.js";
import { EVIDENCE_TYPES, isEvidenceType } from "../models/evidence.js";
import { nextId } from "../utils/id-generator.js";
import { DataAnalystError, EvidenceNotFoundError } from "../utils/errors.js";
import type { InvestigationService } from "./investigation-service.js";

export class EvidenceService {
  private readonly evidence: Map<string, Evidence> = new Map();

  constructor(private readonly investigationService: InvestigationService) {}

  /**
   * Record one piece of evidence and link it to an investigation.
   *
   * @throws InvestigationNotFoundError if the investigation does not exist
   * @throws InvestigationStateError if the investigation is terminal
   * @throws DataAnalystError if the type is unknown or the operation is empty
   */
  recordEvidence(
    investigationId: string,
    type: EvidenceType,
    operation: string,
    input: unknown,
    result: unknown,
  ): Evidence {
    if (!isEvidenceType(type)) {
      throw new DataAnalystError(
        "INVALID_EVIDENCE_TYPE",
        `Unknown evidence type: ${String(type)}. ` +
          `Valid types: ${EVIDENCE_TYPES.join(", ")}`,
        { investigationId, type },
      );
    }

    const trimmedOperation = operation?.trim() ?? "";
    if (trimmedOperation === "") {
      throw new DataAnalystError(
        "INVALID_EVIDENCE",
        "Evidence operation must be a non-empty string",
        { investigationId },
      );
    }

    // Validates existence and that the investigation is still mutable
    this.investigationService.assertMutable(investigationId);

    const record: Evidence = {
      id: nextId("evidence"),
      investigationId,
      type,
      operation: trimmedOperation,
      input,
      result,
      createdAt: new Date().toISOString(),
    };

    this.evidence.set(record.id, record);
    this.investigationService.attachEvidence(investigationId, record.id);

    return record;
  }

  /**
   * Retrieve a single evidence record by ID.
   * @throws EvidenceNotFoundError if no evidence has this ID
   */
  getEvidence(evidenceId: string): Evidence {
    const record = this.evidence.get(evidenceId);
    if (record === undefined) {
      throw new EvidenceNotFoundError(evidenceId);
    }
    return record;
  }

  /**
   * Return all evidence recorded for an investigation, in recording order.
   * The result is consistent with the investigation's evidenceIds links.
   *
   * @throws InvestigationNotFoundError if the investigation does not exist
   */
  getEvidenceForInvestigation(investigationId: string): Evidence[] {
    // Validates that the investigation exists
    const investigation = this.investigationService.getInvestigation(
      investigationId,
    );

    return investigation.evidenceIds
      .map((id) => this.evidence.get(id))
      .filter((record): record is Evidence => record !== undefined);
  }
}
