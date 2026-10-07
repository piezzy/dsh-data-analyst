/**
 * FindingService for dsh-data-analyst.
 *
 * Manages findings (PRD §16). A finding is a claim backed by
 * structured evidence — the service enforces every invariant at
 * record time so that no invalid finding can ever exist:
 *
 *   - the finding must belong to an existing, non-terminal
 *     investigation
 *   - the claim must be non-empty
 *   - evidenceIds must be non-empty (PRD §16 invariant, AC-04)
 *   - every evidence ID must exist
 *   - every evidence record must belong to the SAME investigation
 *   - every hypothesis ID (if provided) must exist and belong to
 *     the SAME investigation
 *   - confidence must be a number in [0, 1] (PRD §21); when
 *     omitted it is calculated deterministically (PRD §28)
 *   - new findings start as "unverified" (AC-05) — a finding is
 *     never silently treated as a verified conclusion
 */

import type { Finding } from "../models/finding.js";
import type { Hypothesis } from "../models/hypothesis.js";
import { calculateConfidence, hypothesisSupportRatio } from "../utils/confidence.js";
import { nextId } from "../utils/id-generator.js";
import {
  DataAnalystError,
  FindingNotFoundError,
  HypothesisNotFoundError,
  InvestigationNotFoundError,
} from "../utils/errors.js";
import type { EvidenceService } from "./evidence-service.js";
import type { InvestigationService } from "./investigation-service.js";

export interface RecordFindingOptions {
  hypothesisIds?: string[];
  /**
   * Explicit confidence in [0, 1]. When omitted, confidence is
   * calculated deterministically from evidence availability and
   * hypothesis support (PRD §21: confidence must not equal model
   * certainty).
   */
  confidence?: number;
}

export class FindingService {
  private readonly findings: Map<string, Finding> = new Map();

  constructor(
    private readonly investigationService: InvestigationService,
    private readonly evidenceService: EvidenceService,
  ) {}

  /**
   * Record a finding for an investigation.
   *
   * @throws InvestigationNotFoundError / InvestigationStateError if the
   *         investigation is missing or terminal
   * @throws DataAnalystError if the claim is empty, no evidence is
   *         referenced, a cross-investigation reference is detected,
   *         or confidence is out of [0, 1]
   * @throws EvidenceNotFoundError if an evidence ID does not exist
   * @throws HypothesisNotFoundError if a hypothesis ID does not exist
   *         in this investigation
   */
  recordFinding(
    investigationId: string,
    claim: string,
    evidenceIds: string[],
    options?: RecordFindingOptions,
  ): Finding {
    // The investigation must exist and still be mutable
    this.investigationService.assertMutable(investigationId);

    const trimmedClaim = claim?.trim() ?? "";
    if (trimmedClaim === "") {
      throw new DataAnalystError(
        "INVALID_CLAIM",
        "Finding claim must be a non-empty string",
        { investigationId },
      );
    }

    // PRD §16 invariant / AC-04: a finding without evidence is invalid
    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
      throw new DataAnalystError(
        "FINDING_REQUIRES_EVIDENCE",
        "A finding must reference at least one evidence ID",
        { investigationId },
      );
    }

    // Every evidence ID must exist and belong to this investigation
    for (const evidenceId of evidenceIds) {
      const evidence = this.evidenceService.getEvidence(evidenceId);
      if (evidence.investigationId !== investigationId) {
        throw new DataAnalystError(
          "CROSS_INVESTIGATION_EVIDENCE",
          `Evidence ${evidenceId} belongs to investigation ` +
            `${evidence.investigationId}, not ${investigationId}`,
          { evidenceId, evidenceInvestigationId: evidence.investigationId, investigationId },
        );
      }
    }

    // Hypothesis references (optional) must exist in this investigation.
    // Hypotheses are scoped per-investigation, so a foreign hypothesis
    // ID is simply not found among this investigation's hypotheses.
    let linkedHypotheses: Hypothesis[] = [];
    const hypothesisIds = options?.hypothesisIds;
    if (hypothesisIds !== undefined && hypothesisIds.length > 0) {
      const investigation = this.investigationService.getInvestigation(
        investigationId,
      );

      linkedHypotheses = hypothesisIds.map((hypothesisId) => {
        const hypothesis = investigation.hypotheses.find(
          (h) => h.id === hypothesisId,
        );
        if (hypothesis === undefined) {
          throw new HypothesisNotFoundError(hypothesisId, investigationId);
        }
        return hypothesis;
      });
    }

    // Confidence: validated when supplied, calculated otherwise (PRD §21)
    let confidence: number;
    if (options?.confidence !== undefined) {
      const supplied = options.confidence;
      if (
        typeof supplied !== "number" ||
        !Number.isFinite(supplied) ||
        supplied < 0 ||
        supplied > 1
      ) {
        throw new DataAnalystError(
          "INVALID_CONFIDENCE",
          `Finding confidence must be a number between 0 and 1, got ${String(supplied)}`,
          { investigationId, confidence: supplied },
        );
      }
      confidence = supplied;
    } else {
      confidence = calculateConfidence(
        evidenceIds.length,
        hypothesisSupportRatio(
          linkedHypotheses.map((h) => h.status),
        ),
      );
    }

    const finding: Finding = {
      id: nextId("finding"),
      investigationId,
      claim: trimmedClaim,
      evidenceIds: [...evidenceIds],
      confidence,
      verificationStatus: "unverified",
    };

    if (linkedHypotheses.length > 0) {
      finding.hypothesisIds = linkedHypotheses.map((h) => h.id);
    }

    this.findings.set(finding.id, finding);
    return finding;
  }

  /**
   * Retrieve a finding by ID.
   * @throws FindingNotFoundError if no finding has this ID
   */
  getFinding(findingId: string): Finding {
    const finding = this.findings.get(findingId);
    if (finding === undefined) {
      throw new FindingNotFoundError(findingId);
    }
    return finding;
  }

  /**
   * Return all findings for an investigation, in record order.
   * @throws InvestigationNotFoundError if the investigation does not exist
   */
  getFindingsForInvestigation(investigationId: string): Finding[] {
    // Validates that the investigation exists
    this.investigationService.getInvestigation(investigationId);

    return Array.from(this.findings.values()).filter(
      (finding) => finding.investigationId === investigationId,
    );
  }
}
