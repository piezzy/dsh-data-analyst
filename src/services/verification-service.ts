/**
 * VerificationService for dsh-data-analyst.
 *
 * PRD §17: Verification must answer "Does the evidence actually
 * support the claim?" — and it must do so DETERMINISTICALLY.
 * The LLM never decides whether a numerical result is correct.
 *
 * How deterministic re-verification works:
 *
 *   1. Load the finding and its referenced evidence records.
 *   2. For each evidence record, check — as DISTINCT concepts:
 *        a. the evidence exists
 *        b. the evidence is structurally valid
 *        c. the evidence belongs to the same investigation
 *        d. the evidence can be reproduced
 *        e. the reproduced result matches the recorded result
 *   3. Reproduction (step d/e): when the evidence operation is
 *      one of the analysis engine's deterministic operations
 *      ("aggregate", "compare", "trend") and its recorded input
 *      is the corresponding engine request, the service RE-RUNS
 *      the exact same computation through the AnalysisEngine and
 *      compares the recomputed result against the recorded
 *      result using deep equality.
 *   4. Aggregate the per-evidence outcomes:
 *        - any missing / invalid / cross-investigation evidence,
 *          or any reproduced-but-mismatched evidence  → REJECTED
 *        - all evidence reproduced and matching          → VERIFIED
 *        - valid evidence that cannot be reproduced      → UNVERIFIED
 *          (the honest answer when exact re-execution is not
 *          possible — the finding is never silently upgraded
 *          to "verified", per AC-05)
 *
 * Reproducibility contract: to be verifiable, evidence must be
 * recorded with operation "aggregate", "compare", or "trend" and
 * with the matching AnalysisEngine request as its `input`. The
 * recorded `result` may be either the engine's `result` field or
 * the full engine response — both are accepted. Evidence produced
 * by any other operation (e.g. "profile", custom operations) is
 * valid but not reproducible by the engine, so findings built on
 * it remain unverified rather than being approximately verified.
 *
 * Verification is idempotent: re-running it on unchanged data
 * produces the same status, reason, and per-evidence checks.
 */

import type {
  AggregateRequest,
  AnalysisEngine,
  AnalysisResult,
  CompareRequest,
  TrendRequest,
} from "../models/analysis.js";
import type { Evidence } from "../models/evidence.js";
import { isEvidenceType } from "../models/evidence.js";
import type { Finding } from "../models/finding.js";
import type {
  EvidenceVerification,
  VerificationResult,
} from "../models/verification.js";
import { deepEqual } from "../utils/deep-equal.js";
import {
  EvidenceNotFoundError,
  InvestigationNotFoundError,
} from "../utils/errors.js";
import type { EvidenceService } from "./evidence-service.js";
import type { FindingService } from "./finding-service.js";
import type { InvestigationService } from "./investigation-service.js";

export class VerificationService {
  /** Verification history per finding, in verification order. */
  private readonly verificationResults: Map<
    string,
    VerificationResult[]
  > = new Map();

  constructor(
    private readonly investigationService: InvestigationService,
    private readonly evidenceService: EvidenceService,
    private readonly findingService: FindingService,
    private readonly engine: AnalysisEngine,
  ) {}

  /**
   * Verify a finding by deterministically re-executing its
   * evidence against the dataset.
   *
   * Updates the finding's verificationStatus and
   * verificationReason, stores the structured result, and
   * returns it.
   *
   * @throws FindingNotFoundError if the finding does not exist
   * @throws InvestigationNotFoundError if the finding's
   *         investigation no longer exists
   */
  async verifyFinding(findingId: string): Promise<VerificationResult> {
    const finding = this.findingService.getFinding(findingId);

    // The investigation must still exist
    this.investigationService.getInvestigation(finding.investigationId);

    const checkedEvidence: EvidenceVerification[] = [];
    for (const evidenceId of finding.evidenceIds) {
      checkedEvidence.push(
        await this.verifyEvidence(evidenceId, finding.investigationId),
      );
    }

    const { status, reason } = this.aggregateResults(checkedEvidence);

    finding.verificationStatus = status;
    finding.verificationReason = reason;

    const result: VerificationResult = {
      findingId: finding.id,
      investigationId: finding.investigationId,
      claim: finding.claim,
      status,
      reason,
      checkedEvidence,
      verifiedAt: new Date().toISOString(),
    };

    const history = this.verificationResults.get(findingId) ?? [];
    history.push(result);
    this.verificationResults.set(findingId, history);

    return result;
  }

  /**
   * Return the latest verification result for a finding.
   * Undefined when the finding has never been verified.
   */
  getVerificationResult(findingId: string): VerificationResult | undefined {
    const history = this.verificationResults.get(findingId);
    if (history === undefined || history.length === 0) {
      return undefined;
    }
    return history[history.length - 1];
  }

  /** Return the full verification history for a finding. */
  getVerificationHistory(findingId: string): VerificationResult[] {
    return [...(this.verificationResults.get(findingId) ?? [])];
  }

  /**
   * Verify a single evidence record against the investigation.
   * Keeps the four verification concepts distinct (exists /
   * structurally valid / reproducible / matches).
   */
  private async verifyEvidence(
    evidenceId: string,
    investigationId: string,
  ): Promise<EvidenceVerification> {
    // Concept 1: evidence exists
    let evidence: Evidence;
    try {
      evidence = this.evidenceService.getEvidence(evidenceId);
    } catch (err) {
      if (err instanceof EvidenceNotFoundError) {
        return {
          evidenceId,
          exists: false,
          structurallyValid: false,
          sameInvestigation: false,
          reproducible: false,
          reason: `Evidence ${evidenceId} not found`,
        };
      }
      throw err;
    }

    // Evidence must belong to the same investigation as the finding
    if (evidence.investigationId !== investigationId) {
      return {
        evidenceId,
        exists: true,
        structurallyValid: true,
        sameInvestigation: false,
        reproducible: false,
        reason:
          `Evidence ${evidenceId} belongs to investigation ` +
          `${evidence.investigationId}, not ${investigationId}`,
      };
    }

    // Concept 2: structurally valid
    if (!this.isStructurallyValid(evidence)) {
      return {
        evidenceId,
        exists: true,
        structurallyValid: false,
        sameInvestigation: true,
        reproducible: false,
        reason:
          `Evidence ${evidenceId} is structurally invalid: ` +
          "it must have a valid type, a non-empty operation, and a result",
      };
    }

    // Concept 3: reproducible — re-run the deterministic analysis
    const reproduced = await this.reproduce(evidence);
    if (reproduced === null) {
      return {
        evidenceId,
        exists: true,
        structurallyValid: true,
        sameInvestigation: true,
        reproducible: false,
        reason:
          `Operation "${evidence.operation}" cannot be re-executed ` +
          "deterministically by the analysis engine",
      };
    }

    // Concept 4: does the recomputed result match the recorded result?
    const matches =
      deepEqual(evidence.result, reproduced.result) ||
      deepEqual(evidence.result, reproduced);

    return {
      evidenceId,
      exists: true,
      structurallyValid: true,
      sameInvestigation: true,
      reproducible: true,
      recordedResult: evidence.result,
      reproducedResult: reproduced.result,
      matches,
      ...(matches ? {} : { reason: `Recomputed result for evidence ${evidenceId} does not match the recorded result` }),
    };
  }

  /**
   * Structural validity: a well-formed evidence record has a
   * known type, a non-empty operation, and a recorded result.
   */
  private isStructurallyValid(evidence: Evidence): boolean {
    return (
      isEvidenceType(evidence.type) &&
      typeof evidence.operation === "string" &&
      evidence.operation.trim() !== "" &&
      evidence.result !== undefined
    );
  }

  /**
   * Re-execute the deterministic analysis behind an evidence
   * record. Returns the full engine response, or null when the
   * evidence cannot be reproduced (unknown operation, or the
   * engine could not execute the recorded request — e.g. the
   * dataset is no longer loaded).
   */
  private async reproduce(
    evidence: Evidence,
  ): Promise<AnalysisResult<unknown> | null> {
    if (
      typeof evidence.input !== "object" ||
      evidence.input === null
    ) {
      return null;
    }

    const request = evidence.input as Record<string, unknown>;

    try {
      switch (evidence.operation) {
        case "aggregate":
          return await this.engine.aggregate(
            request as unknown as AggregateRequest,
          );
        case "compare":
          return await this.engine.compare(
            request as unknown as CompareRequest,
          );
        case "trend":
          return await this.engine.trend(
            request as unknown as TrendRequest,
          );
        default:
          return null;
      }
    } catch {
      // The engine could not re-execute the recorded request
      // (e.g. dataset unloaded, invalid request). The evidence
      // is valid but not reproducible — verification cannot
      // confirm it, so the finding stays unverified.
      return null;
    }
  }

  /**
   * Aggregate per-evidence outcomes into the overall
   * verification status and reason.
   */
  private aggregateResults(
    checks: EvidenceVerification[],
  ): { status: VerificationResult["status"]; reason: string } {
    const failures: string[] = [];
    const nonReproducible: string[] = [];

    for (const check of checks) {
      if (!check.exists) {
        failures.push(`evidence ${check.evidenceId} does not exist`);
      } else if (!check.structurallyValid) {
        failures.push(
          `evidence ${check.evidenceId} is structurally invalid`,
        );
      } else if (!check.sameInvestigation) {
        failures.push(
          `evidence ${check.evidenceId} belongs to a different investigation`,
        );
      } else if (check.matches === false) {
        failures.push(
          `evidence ${check.evidenceId} does not match its recomputed result`,
        );
      } else if (!check.reproducible) {
        nonReproducible.push(
          `evidence ${check.evidenceId} could not be reproduced ` +
            `(${check.reason ?? "unknown reason"})`,
        );
      }
    }

    if (failures.length > 0) {
      return {
        status: "rejected",
        reason: `Finding rejected: ${failures.join("; ")}`,
      };
    }

    if (nonReproducible.length > 0) {
      return {
        status: "unverified",
        reason: `Finding remains unverified: ${nonReproducible.join("; ")}`,
      };
    }

    return {
      status: "verified",
      reason:
        `All ${checks.length} evidence record(s) were reproduced ` +
        "deterministically and match the recorded results",
    };
  }
}
